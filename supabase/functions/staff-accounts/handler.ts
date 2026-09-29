/**
 * Privileged staff account operations: create a sign-in account, reset a
 * forgotten password, and email a reset link to an administrator who has
 * forgotten theirs.
 *
 * WHY THIS EXISTS AS A SEPARATE FUNCTION
 * --------------------------------------
 * Creating or resetting a Supabase Auth account needs the `service_role` key,
 * which bypasses every row-level security policy in the database. Putting that
 * key in the browser would hand the patient table to anyone who opened
 * devtools, so the browser cannot do this - hence this function, which holds
 * the key server-side and never returns it.
 *
 * The split is the whole point, and it is a narrow one: the browser keeps
 * writing ordinary clinic data straight to Postgres through RLS, and only the
 * three operations that genuinely require the privileged key come here.
 *
 * WHAT IS TRUSTED HERE, AND WHAT IS NOT
 * -------------------------------------
 * The request body is NEVER trusted. It supplies an email address and a
 * password, and nothing else that matters. In particular the handler ignores
 * any `role`, `user_id` or `is_admin` the caller might add, and works out
 * permission from exactly one source: the email inside the caller's own
 * verified JWT, resolved against `public.users` to require an active
 * ADMINISTRATOR. If the browser says the caller is an administrator, that is
 * irrelevant; only the database decides.
 *
 * Every privileged action is written to `audit_logs`, because "who reset
 * whose password" is the first question asked after any account incident.
 *
 * The environment is a parameter rather than read from `Deno.env` inside the
 * logic, so `scripts/check-staff-accounts.mjs` can execute this exact file
 * against the live project under Node. Testing a reimplementation would prove
 * nothing about the code that actually runs.
 */

/** Configuration the handler needs. Passed in, never read from a global. */
export interface HandlerEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

interface StaffProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  auth_user_id: string | null;
  must_change_password: boolean;
}

interface AuthUser {
  id: string;
  email: string;
  user_metadata?: Record<string, unknown>;
}

/** Machine-readable failure codes, so the UI can react rather than match on prose. */
export type FailureCode =
  | 'missing_token'
  | 'not_admin'
  | 'invalid_email'
  | 'weak_password'
  | 'no_staff_profile'
  | 'account_exists'
  | 'no_auth_account'
  | 'upstream_failure';

/**
 * A refusal the caller is allowed to see.
 *
 * Written with explicit fields rather than TypeScript parameter properties
 * because the test harness runs this file under Node's type stripping, which
 * only erases types and cannot transform constructor shorthand.
 */
class HttpError extends Error {
  readonly status: number;
  readonly code: FailureCode;

  constructor(status: number, code: FailureCode, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

// --- Password policy --------------------------------------------------------

/**
 * A short denylist, not a real strength meter.
 *
 * The goal is to reject the handful of passwords that make a "you must change
 * this" prompt trivially bypassable, without standing in the way of a clinician
 * choosing something on a ward keyboard in a hurry. Anything stricter pushes
 * people towards writing it on the monitor, which is worse.
 */
const TOO_WEAK = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwertyuiop', 'letmein123', 'welcome123', 'admin1234', 'iloveyou123',
  'fatclinic', 'fatclinic123', 'solacemedicares', 'solacemedicares123',
  'clinic1234', 'hospital123',
]);

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

/**
 * Validate a password chosen by an administrator on a colleague's behalf.
 *
 * Enforced here rather than only in the form because client-side validation of a
 * secret is theatre: it can be skipped by opening the console, so this is the
 * check that counts. The form runs the same rules first only so that a mistake
 * is caught before the staff profile is written - see
 * src/services/passwordPolicy.ts, which a test pins to this function.
 *
 * `name` is optional so existing callers and tests keep working, but both
 * operations pass it: a password containing the name of the person it belongs to
 * is guessable by anyone who knows who they work for.
 */
export function checkPassword(password: unknown, email: string, name?: string | null): string | null {
  if (typeof password !== 'string' || password.length === 0) {
    return 'Enter a password.';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `The password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    // Bcrypt truncates at 72 bytes, so a long passphrase is silently weakened.
    return `The password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  if (password !== password.trim()) {
    // Refused rather than trimmed. Trimming would let an administrator set a
    // password that is not the one they typed, and the mismatch would only
    // surface as "I cannot sign in" from the person holding the phone.
    return 'The password must not begin or end with a space.';
  }
  if (/\s/.test(password)) {
    return 'The password must not contain spaces.';
  }
  if (TOO_WEAK.has(password.toLowerCase())) {
    return 'That password is too common. Choose something less predictable.';
  }
  const localPart = email.split('@')[0] ?? '';
  if (localPart.length >= 4 && password.toLowerCase().includes(localPart.toLowerCase())) {
    return 'The password must not contain the staff email address.';
  }
  // Every word of the name that is long enough to identify somebody. Short words
  // are skipped: "Obi" or "Ana" would reject a great many reasonable passwords
  // and train people to ignore this rule.
  for (const word of (name ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4)) {
    if (password.toLowerCase().includes(word)) {
      return 'The password must not contain the staff member’s name.';
    }
  }
  if (/^(.)\1+$/.test(password)) {
    return 'The password must not be a single repeated character.';
  }
  return null;
}

/** Lowercase and trim an address, rejecting anything that is not plainly one. */
export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  // A newline would be a header-injection attempt against the upstream API.
  if (/[\s\r\n]/.test(email)) return null;
  // Deliberately loose: a strict RFC parser rejects legal addresses, and the
  // real validation is that Supabase has to accept it.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

// --- Upstream calls ---------------------------------------------------------

const jsonHeaders = { 'Content-Type': 'application/json' };

/** GoTrue, with the caller's own token. Proves who is calling. */
async function gotrueAsCaller(env: HandlerEnv, path: string, token: string, init: RequestInit = {}) {
  return fetch(`${env.SUPABASE_URL}/auth/v1${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      ...jsonHeaders,
      ...(init.headers ?? {}),
    },
  });
}

/** GoTrue, with the privileged key. Never leaves this function. */
async function gotrueAsAdmin(env: HandlerEnv, path: string, init: RequestInit = {}) {
  return fetch(`${env.SUPABASE_URL}/auth/v1${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...jsonHeaders,
      ...(init.headers ?? {}),
    },
  });
}

/** PostgREST, with the privileged key, so RLS does not hide the row we need. */
async function restAsAdmin(env: HandlerEnv, path: string, init: RequestInit = {}) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...jsonHeaders,
      // Without this, an UPDATE reports 204 and cannot confirm what it wrote.
      Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  });
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 200) };
  }
}

// --- Authorisation ----------------------------------------------------------

/**
 * Resolve the caller and prove they are allowed to do this.
 *
 * Two independent things are established. First the bearer token is exchanged
 * for an identity, so a caller cannot claim an address by putting it in the
 * body. Then that address is resolved to a staff profile, which must exist,
 * be active, and be an administrator. A disabled administrator is refused: the
 * profile's `active` flag is what the whole rest of the application trusts, so
 * it cannot be quietly ignored on the one privileged path.
 */
async function requireAdmin(
  env: HandlerEnv,
  token: string,
): Promise<{ email: string; profile: StaffProfile }> {
  const whoami = await gotrueAsCaller(env, '/user', token);
  if (!whoami.ok) {
    throw new HttpError(401, 'missing_token', 'Your session has expired. Sign in again.');
  }
  const identity = await readJson(whoami);
  const email = normaliseEmail(identity?.email);
  if (!email) {
    throw new HttpError(401, 'missing_token', 'Your session has expired. Sign in again.');
  }

  const res = await restAsAdmin(
    env,
    `users?email=ilike.${encodeURIComponent(email)}&select=id,name,email,role,active,auth_user_id,must_change_password&limit=5`,
  );
  if (!res.ok) {
    throw new HttpError(502, 'upstream_failure', 'Could not reach the staff register. Try again.');
  }
  const rows: StaffProfile[] = await readJson(res);
  // Re-apply an exact match: `_` is a wildcard in `ilike` and is a legal
  // character in an address, so a loose match could resolve to a neighbour.
  const profile = (rows ?? []).find((r) => String(r.email).toLowerCase() === email);

  if (!profile) {
    throw new HttpError(403, 'not_admin', 'This action is restricted to clinic administrators.');
  }
  if (!profile.active) {
    throw new HttpError(403, 'not_admin', 'This staff account has been disabled.');
  }
  if (profile.role !== 'ADMINISTRATOR') {
    throw new HttpError(403, 'not_admin', 'This action is restricted to clinic administrators.');
  }
  return { email, profile };
}

/** The staff profile for an address, or null. Existence only, no permission. */
async function findProfile(env: HandlerEnv, email: string): Promise<StaffProfile | null> {
  const res = await restAsAdmin(
    env,
    `users?email=ilike.${encodeURIComponent(email)}&select=id,name,email,role,active,auth_user_id,must_change_password&limit=5`,
  );
  if (!res.ok) return null;
  const rows: StaffProfile[] = await readJson(res);
  return (rows ?? []).find((r) => String(r.email).toLowerCase() === email) ?? null;
}

/**
 * Find an auth account by email.
 *
 * This project ignores `?filter=` on the admin list endpoint and answers 200
 * with zero users, which is the dangerous shape: it reads as "no such account"
 * and would make a reset fail for real staff. `scripts/probe-auth-admin.mjs`
 * pins that behaviour, so paging is used deliberately rather than by preference.
 */
async function findAuthUser(env: HandlerEnv, email: string): Promise<AuthUser | null> {
  const PER_PAGE = 1000;
  for (let page = 1; page <= 20; page++) {
    const res = await gotrueAsAdmin(env, `/admin/users?page=${page}&per_page=${PER_PAGE}`);
    if (!res.ok) {
      throw new HttpError(502, 'upstream_failure', 'Could not reach the sign-in service. Try again.');
    }
    const body = await readJson(res);
    const users: AuthUser[] = body?.users ?? [];
    const hit = users.find((u) => String(u.email).toLowerCase() === email);
    if (hit) return hit;
    if (users.length < PER_PAGE) return null;
  }
  return null;
}

// --- Audit ------------------------------------------------------------------

/**
 * Record a privileged account action.
 *
 * Best effort by design, and deliberately so: a failure to write the audit row
 * is logged but does not undo an account change that already succeeded. Refusing
 * to create a staff account because the audit insert failed would leave an
 * administrator unable to onboard anybody during an outage, which is a worse
 * outcome than a gap in one log line - and the failure is surfaced in the
 * function's own logs, where someone is watching.
 *
 * `actor` is nullable because "forgot" is asked for BY the person who cannot
 * sign in, so there is no identity to attribute it to. Inventing one - reusing
 * the address they typed as though it were an authenticated caller - would put a
 * false actor in the very log an auditor reads to answer "who asked for this?".
 * So the row is written unattributed, with `session: 'none'` in the metadata to
 * say plainly that no session existed. An unattributed entry is visible; a
 * misattributed one is worse than nothing.
 */
async function audit(
  env: HandlerEnv,
  actor: StaffProfile | null,
  entry: { action: string; targetEmail: string; targetId: string | null; outcome: string },
): Promise<void> {
  try {
    await restAsAdmin(env, 'audit_logs', {
      method: 'POST',
      body: JSON.stringify({
        // `SEC-`, not the app's `LOG-`, so a privileged write can never collide
        // with a row the browser produced.
        id: `SEC-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        user_id: actor?.id ?? null,
        user_name: actor?.name ?? '',
        // `NONE`, not a role: nobody was authenticated to have one. Left blank
        // this reads as a row the writer forgot to fill in.
        user_role: actor?.role ?? 'NONE',
        // No patient, and deliberately no password: a log is the wrong place for
        // a credential, and anything written here is readable by every member
        // of staff through the admin audit screen.
        action: entry.action,
        category: 'ADMIN',
        details:
          `${entry.outcome}: ${entry.action} for ${entry.targetEmail}` +
          (entry.targetId ? ` (profile ${entry.targetId})` : ''),
        metadata: {
          source: 'staff-accounts-function',
          actor_email: actor?.email ?? null,
          session: actor ? 'admin' : 'none',
        },
      }),
    });
  } catch (err) {
    console.error('[staff-accounts] AUDIT WRITE FAILED', {
      action: entry.action,
      target: entry.targetEmail,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// --- Operations -------------------------------------------------------------

interface CreateBody {
  action: 'create';
  email: unknown;
  password: unknown;
}

interface ResetBody {
  action: 'reset';
  email: unknown;
  password: unknown;
}

interface ForgotBody {
  action: 'forgot';
  email: unknown;
}

/**
 * Sent to anyone whose address is not a clinic administrator.
 *
 * Short and directive on purpose, and the only wording: the person reading it
 * is someone who has just been told this route exists and has found it closed to
 * them, so it says where to go instead of explaining why they are standing
 * there. Kept identical for an address with no staff profile at all, which is
 * what stops this endpoint being used to discover who works here - see
 * `db:check-forgot-password`, which asserts the two replies are equal rather than
 * merely alike.
 */
const ASK_THE_ADMINISTRATOR = 'Contact Clinic Administrator for reset';

/** Sent once a reset link has been handed to Supabase's mailer. */
const CHECK_THE_INBOX =
  'A password reset link is on its way to that address. Check the inbox, including the spam folder.';

/**
 * Email a password-reset link, but only to a clinic administrator.
 *
 * WHAT THIS IS, AND WHY IT IS HERE RATHER THAN IN THE BROWSER
 * ----------------------------------------------------------
 * The obvious implementation is one call to `supabase.auth.resetPasswordForEmail`
 * from the sign-in form, needing no function and no privileged key at all. It is
 * wrong for this clinic, and precisely because it is too generous: GoTrue will
 * mail a reset link to ANY registered address, so a clinician who types their own
 * email gets a working reset and is never routed to their administrator. The
 * stated rule is that only administrators reset themselves by email, and
 * everyone else is pointed at the person who can do it for them.
 *
 * Deciding that requires reading `public.users`, and while signed out RLS refuses
 * every read of it - `app_is_staff()` is false without a session, and the column
 * grant is the whole table. So the decision has to happen somewhere holding the
 * privileged key: here.
 *
 * WHAT IS DELIBERATELY NOT DONE
 * -----------------------------
 * The reply is not the same for every address, and that is a knowing trade rather
 * than an oversight. A uniform "if that address is an administrator, check your
 * inbox" would hide which addresses are administrators - and this endpoint is
 * reachable without a session, so it would be a way to enumerate the clinic's
 * senior staff from the open internet. It is accepted instead because the thing
 * it gives away is not a secret: any signed-in member of staff can already read
 * the full staff list, roles included, and the alternative strands a clinician
 * who has just been told to wait for an email that will never arrive.
 *
 * Two things are still hidden, and both matter more:
 *
 *  - An address with no staff profile gets the SAME reply as an existing
 *    clinician, so the endpoint cannot be used to discover who works here.
 *  - Nothing is revealed about the sign-in account itself, because the decision
 *    is made on the staff profile, not on whether GoTrue happens to have a
 *    matching auth user.
 *
 * THE REPLY IS DELIBERATELY NOT `ok: false`
 * -----------------------------------------
 * Being a clinician rather than an administrator is the expected outcome of
 * typing your own address, not a failure, so this returns 200 with `sent: false`
 * and the sentence to show. Modelling it as an error would make every legitimate
 * use of the form render in the same red box as a genuine outage, and would push
 * the client toward treating "not an administrator" as something to retry.
 *
 * The client shows that sentence in a neutral panel rather than an error box,
 * because it is a completed request that arrived at a definite answer. The
 * accompanying form carries no notice about who this route is for; the outcome
 * is the first and only place the rule is stated.
 */
async function opForgot(env: HandlerEnv, body: ForgotBody) {
  const email = normaliseEmail(body.email);
  if (!email) {
    throw new HttpError(400, 'invalid_email', 'Enter a valid email address.');
  }

  const profile = await findProfile(env, email);
  const isAdministrator = Boolean(profile?.active) && profile?.role === 'ADMINISTRATOR';

  if (!isAdministrator || !profile) {
    await audit(env, null, {
      action: 'SEND_PASSWORD_RESET_EMAIL',
      targetEmail: email,
      // The profile id is recorded only when one exists. It is not echoed to the
      // caller, so this stays a server-side log line and costs the response
      // nothing: both branches return the same two fields.
      targetId: profile?.id ?? null,
      outcome: 'refused:not_administrator',
    });
    return { status: 200, body: { ok: true, sent: false, message: ASK_THE_ADMINISTRATOR } };
  }

  // An administrator profile with no sign-in account. There is nothing to reset,
  // and asking GoTrue anyway would produce a cheerful "sent" for a mail that can
  // never be written, which is how a locked-out administrator gets stranded.
  if (!profile.auth_user_id) {
    await audit(env, null, {
      action: 'SEND_PASSWORD_RESET_EMAIL',
      targetEmail: email,
      targetId: profile.id,
      outcome: 'refused:no_sign_in_account',
    });
    return {
      status: 200,
      body: {
        ok: true,
        sent: false,
        message:
          'That administrator has no sign-in account yet. Ask another administrator to create one for them.',
      },
    };
  }

  // GoTrue's public recovery endpoint, called with the ANON key rather than the
  // privileged one. That is not a shortcut: the mail itself is not a privileged
  // operation, and only the role check above is. Using anon here keeps the
  // capability this function holds to the one thing it genuinely needs it for,
  // so widening the endpoint later cannot silently widen this too.
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/recover`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, ...jsonHeaders },
    body: JSON.stringify({ email }),
  });

  if (!res.ok) {
    console.error('[staff-accounts] recover refused', res.status, await readJson(res));
    throw new HttpError(502, 'upstream_failure', 'Could not reach the sign-in service. Try again.');
  }

  await audit(env, null, {
    action: 'SEND_PASSWORD_RESET_EMAIL',
    targetEmail: email,
    targetId: profile.id,
    outcome: 'sent',
  });
  return { status: 200, body: { ok: true, sent: true, message: CHECK_THE_INBOX } };
}

/**
 * Create the sign-in account for a staff profile that already exists.
 *
 * The profile is written by the application through the normal RLS-protected
 * path, and only this step is privileged. That ordering is not arbitrary: if
 * the account creation fails, the leftover is a profile with no sign-in
 * account, which is inert and retryable. The reverse - an auth account with no
 * profile - would leave a live credential on the project that has to be found
 * and deleted by hand.
 */
async function opCreate(env: HandlerEnv, body: CreateBody, actor: StaffProfile) {
  const email = normaliseEmail(body.email);
  if (!email) {
    throw new HttpError(400, 'invalid_email', 'That email address is not valid.');
  }

  // The profile has to be looked up before the password can be judged against
  // the name, so this is the one rule that cannot be checked before it. The form
  // checks it client-side anyway, so in practice this only fires for a caller
  // that skipped the form.
  const profile = await findProfile(env, email);
  if (!profile) {
    throw new HttpError(
      404,
      'no_staff_profile',
      'There is no staff profile for that address. Save the profile first, then create the sign-in account.',
    );
  }
  if (!profile.active) {
    throw new HttpError(400, 'no_staff_profile', 'That staff profile is disabled. Enable it before creating an account.');
  }

  const weak = checkPassword(body.password, email, profile.name);
  if (weak) throw new HttpError(400, 'weak_password', weak);

  const existing = await findAuthUser(env, email);
  if (existing) {
    throw new HttpError(
      409,
      'account_exists',
      'A sign-in account already exists for that address. Reset the password instead of creating a second one.',
    );
  }

  // `email_confirm: true` because there is no working mail relay on this
  // project: a confirmation requirement would leave the account unable to sign
  // in and no way for the person to resolve it. The credential is delivered out
  // of band by the administrator, and the user is required to replace it.
  const created = await gotrueAsAdmin(env, '/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password: body.password,
      email_confirm: true,
    }),
  });
  const createdBody = await readJson(created);
  if (!created.ok || !createdBody?.id) {
    const upstream = createdBody?.msg || createdBody?.error_code || `status ${created.status}`;
    console.error('[staff-accounts] create failed', { email, upstream });
    // 422 here is GoTrue's duplicate-address rejection, which is a user-facing
    // condition rather than an outage, so it is reported as a conflict.
    if (created.status === 422) {
      throw new HttpError(409, 'account_exists', 'A sign-in account already exists for that address.');
    }
    throw new HttpError(502, 'upstream_failure', 'The sign-in account could not be created. Try again.');
  }

  // Link the two halves and require the new credential to be replaced. The
  // administrator chose this password and read it out over a ward telephone;
  // it must never remain the standing credential.
  const link = await restAsAdmin(env, `users?id=eq.${encodeURIComponent(profile.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ auth_user_id: createdBody.id, must_change_password: true }),
  });
  if (!link.ok) {
    console.error('[staff-accounts] account created but linking the profile FAILED', {
      email,
      auth_user_id: createdBody.id,
      profile: profile.id,
      status: link.status,
      body: (await link.text()).slice(0, 300),
    });
  }
  const linked = link.ok;

  await audit(env, actor, {
    action: 'CREATE_STAFF_ACCOUNT',
    targetEmail: email,
    targetId: profile.id,
    outcome: 'ok',
  });

  return {
    status: 201,
    body: {
      ok: true,
      code: 'created',
      message: linked
        ? 'Sign-in account created. This person must choose their own password at first sign-in.'
        : 'Sign-in account created, but the profile could not be updated. The account works, but ask for a password reset to finish linking it.',
      data: { email, profileId: profile.id, authUserId: createdBody.id, linked, mustChangePassword: true },
    },
  };
}

/**
 * Set a new password for an account that already exists.
 *
 * Refuses when there is no auth account rather than creating one, because
 * "reset" and "create" are different acts with different audit meanings: this
 * one implies an account already existed, and quietly minting a new credential
 * for an address that never had one would hide a provisioning mistake.
 */
async function opReset(env: HandlerEnv, body: ResetBody, actor: StaffProfile) {
  const email = normaliseEmail(body.email);
  if (!email) {
    throw new HttpError(400, 'invalid_email', 'That email address is not valid.');
  }

  const profile = await findProfile(env, email);
  if (!profile) {
    throw new HttpError(404, 'no_staff_profile', 'There is no staff profile for that address.');
  }

  const weak = checkPassword(body.password, email, profile.name);
  if (weak) throw new HttpError(400, 'weak_password', weak);

  const authUser = await findAuthUser(env, email);
  if (!authUser) {
    throw new HttpError(
      404,
      'no_auth_account',
      'That person has no sign-in account yet. Create one instead of resetting it.',
    );
  }

  // PUT is the only verb this project routes for an admin user update; PATCH
  // answers 405. Confirmed by scripts/probe-auth-admin.mjs.
  const updated = await gotrueAsAdmin(env, `/admin/users/${encodeURIComponent(authUser.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ password: body.password }),
  });
  if (!updated.ok) {
    const detail = await readJson(updated);
    console.error('[staff-accounts] reset failed', { email, status: updated.status, detail });
    throw new HttpError(502, 'upstream_failure', 'The password could not be changed. Try again.');
  }

  // Every session already issued for that account is invalidated, so a password
  // change actually revokes whoever prompted it. Without this, a forgotten
  // password reset would leave the previous holder signed in.
  await restAsAdmin(env, `users?id=eq.${encodeURIComponent(profile.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ must_change_password: true, auth_user_id: authUser.id }),
  });

  await audit(env, actor, {
    action: 'RESET_STAFF_PASSWORD',
    targetEmail: email,
    targetId: profile.id,
    outcome: 'ok',
  });

  return {
    status: 200,
    body: {
      ok: true,
      code: 'reset',
      message: 'Password changed. This person must choose their own password at next sign-in, and any existing session has been ended.',
      data: { email, profileId: profile.id, authUserId: authUser.id, mustChangePassword: true },
    },
  };
}

// --- Entry point ------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  // Safe as a wildcard because nothing here is cookie-authenticated: the caller
  // is proved by a bearer JWT, which a third-party page cannot obtain.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, ...jsonHeaders },
  });
}

export async function handleStaffAccountRequest(req: Request, env: HandlerEnv): Promise<Response> {
  // The browser sends a preflight because the Authorization header is not
  // "simple". Without this the request never reaches the handler.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return respond(405, { ok: false, code: 'upstream_failure', message: 'Use POST.' });
  }

  const missing = (['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const).filter(
    (k) => !env[k],
  );
  if (missing.length) {
    console.error('[staff-accounts] missing function secrets', missing);
    return respond(500, { ok: false, code: 'upstream_failure', message: 'This function is not configured.' });
  }

  let body: CreateBody | ResetBody | ForgotBody;
  try {
    body = await req.json();
  } catch {
    return respond(400, { ok: false, code: 'upstream_failure', message: 'Malformed request.' });
  }

  // `forgot` is answered BEFORE the session check below, and that ordering is the
  // feature rather than an accident of where the block sits.
  //
  // It has to be. "Forgot password" exists for the person who is locked out, so a
  // gate that demands a valid session refuses to answer the one request it was
  // built for - and there is nothing to authenticate, because the whole problem
  // is that they cannot. Everything after this block still requires an active
  // ADMINISTRATOR; the only thing that changes is which operations exist for
  // somebody signed out.
  //
  // Note what it does NOT do: it does not become a bypass for the other actions.
  // `create` and `reset` fall straight through to the unchanged token check
  // below, and an unrecognised action still cannot be distinguished from `create`
  // or `reset` by a signed-out caller - they get the same 401, so the endpoint
  // still cannot be used to probe which action names exist.
  if (body?.action === 'forgot') {
    try {
      const result = await opForgot(env, body as ForgotBody);
      return respond(result.status, result.body);
    } catch (err) {
      if (err instanceof HttpError) {
        // A refusal here is a malformed address rather than a permission
        // decision, so it is still worth a line: someone hammering this with
        // junk is visible, and the real address never reaches the mailer.
        await audit(env, null, {
          action: 'SEND_PASSWORD_RESET_EMAIL',
          targetEmail: typeof (body as { email?: unknown }).email === 'string'
            ? String((body as { email: string }).email).slice(0, 254)
            : '(not an address)',
          targetId: null,
          outcome: `refused:${err.code}`,
        });
        return respond(err.status, { ok: false, code: err.code, message: err.message });
      }
      console.error('[staff-accounts] forgot failed', err);
      return respond(500, { ok: false, code: 'upstream_failure', message: 'Something went wrong. Try again.' });
    }
  }

  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) {
    return respond(401, { ok: false, code: 'missing_token', message: 'Sign in again.' });
  }

  let actor: StaffProfile;
  try {
    actor = (await requireAdmin(env, token)).profile;
  } catch (err) {
    // Recorded against a synthetic actor because the caller was never resolved,
    // and an unauthenticated attempt is exactly the thing worth a log line.
    if (err instanceof HttpError) {
      if (err.status !== 401) console.warn('[staff-accounts] refused', err.code, err.message);
      return respond(err.status, { ok: false, code: err.code, message: err.message });
    }
    console.error('[staff-accounts] authorisation threw', err);
    return respond(502, { ok: false, code: 'upstream_failure', message: 'Could not verify your permissions. Try again.' });
  }

  try {
    const result =
      body?.action === 'create'
        ? await opCreate(env, body as CreateBody, actor)
        : body?.action === 'reset'
          ? await opReset(env, body as ResetBody, actor)
          : null;

    if (!result) {
      return respond(400, {
        ok: false,
        code: 'upstream_failure',
        message: 'Unknown action. Expected "create" or "reset".',
      });
    }
    return respond(result.status, result.body);
  } catch (err) {
    if (err instanceof HttpError) {
      // Only a recognised action is worth a row. An unrecognised one is a
      // malformed request, not an attempt at a known operation, and filing it
      // under whichever action it resembled would put a false entry in the log
      // an auditor reads.
      const known = body?.action === 'create' || body?.action === 'reset';
      if (known) {
        await audit(env, actor, {
          action: body.action === 'create' ? 'CREATE_STAFF_ACCOUNT' : 'RESET_STAFF_PASSWORD',
          targetEmail: String((body as { email?: unknown })?.email ?? ''),
          targetId: null,
          outcome: `refused:${err.code}`,
        });
      }
      return respond(err.status, { ok: false, code: err.code, message: err.message });
    }
    console.error('[staff-accounts] unexpected failure', err);
    return respond(500, { ok: false, code: 'upstream_failure', message: 'Something went wrong. Try again.' });
  }
}
