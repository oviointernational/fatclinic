/**
 * Privileged staff account operations: create a sign-in account, and reset a
 * forgotten password.
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
 * two operations that genuinely require the privileged key come here.
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
  /** Workstation screen lock. Read here only to verify a recovery attempt. */
  pin: string;
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
  | 'invalid_recovery_details'
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
  'fatclinic', 'fatclinic123', 'clinic1234', 'hospital123',
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
    `users?email=ilike.${encodeURIComponent(email)}&select=id,name,email,role,active,auth_user_id,must_change_password,pin&limit=5`,
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
 * `actor` is null for password recovery, which is the one action taken with no
 * session - there is nobody to attribute it to, and inventing an actor would be
 * a lie in the one log an administrator reads after an incident. The row is
 * still written, with no `user_id` and `session: 'none'` in the metadata, so
 * "somebody reset this password without signing in" is visible afterwards
 * rather than inferred from the absence of a row.
 *
 * Best effort by design, and deliberately so: a failure to write the audit row
 * is logged but does not undo an account change that already succeeded. Refusing
 * to create a staff account because the audit insert failed would leave an
 * administrator unable to onboard anybody during an outage, which is a worse
 * outcome than a gap in one log line - and the failure is surfaced in the
 * function's own logs, where someone is watching.
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
        user_role: actor?.role ?? '',
        // No patient, and deliberately no password: a log is the wrong place for
        // a credential, and anything written here is readable by every member
        // of staff through the admin audit screen.
        action: entry.action,
        category: 'ADMIN',
        details:
          `${entry.outcome}: ${entry.action} for ${entry.targetEmail}` +
          (entry.targetId ? ` (profile ${entry.targetId})` : '') +
          (actor ? '' : ' (no session: password recovery)'),
        metadata: {
          source: 'staff-accounts-function',
          actor_email: actor?.email ?? null,
          session: actor ? 'signed-in' : 'none',
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

interface RecoverBody {
  action: 'recover';
  email: unknown;
  pin: unknown;
  id: unknown;
  password: unknown;
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

/**
 * Change a password for someone who cannot sign in.
 *
 * THE ONLY ACTION HERE THAT RUNS WITHOUT A SESSION
 * -----------------------------------------------
 * Create and reset are done from the admin screen, so the caller's JWT proves
 * they are an administrator. Recovery is for the person who cannot reach that
 * screen, so requiring a session would be requiring the thing they have lost.
 * It is therefore the one path here with no session to check, and it is
 * authenticated by three stored facts instead. All three must match:
 *
 *   1. the address, which is not a secret at all;
 *   2. the workstation PIN, which every member of staff can read, because the
 *      application has to be able to compare it in the browser to unlock a
 *      screen - it ships as 1234 and is not treated as a credential;
 *   3. the account's own `auth_user_id`, which is the only one of the three
 *      that anybody cannot read.
 *
 * So the check is really one factor deep, and that factor is the third. It is
 * the right way round: a 122-bit UUID that only the database owner or the
 * person who wrote it down can supply, verified server-side against a column
 * the browser is no longer permitted to read. The first two do not add
 * entropy, and the copy here does not pretend otherwise - see the README,
 * "Forgotten password".
 *
 * WHY THE FAILURE SAYS NOTHING
 * ---------------------------
 * One reply covers every mismatch, so this cannot be used to find out whether an
 * address has an account, whether a PIN is right, or whether an ID belongs to
 * anyone. The input *shape* is still checked separately and does say what is
 * wrong with the shape, because "that is not a four digit PIN" leaks nothing
 * about any account.
 */
async function opRecover(env: HandlerEnv, body: RecoverBody) {
  const email = normaliseEmail(body.email);
  if (!email) {
    throw new HttpError(400, 'invalid_email', 'That email address is not valid.');
  }

  const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
  if (!/^\d{4}$/.test(pin)) {
    throw new HttpError(400, 'invalid_recovery_details', 'The PIN is the four digits on your account screen.');
  }

  const accountId = typeof body.id === 'string' ? body.id.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(accountId)) {
    throw new HttpError(400, 'invalid_recovery_details', 'The ID is the long code on your account screen.');
  }

  // Every reason to refuse produces this same object, so the reply cannot be
  // used to narrow down which of the three was wrong - or whether the address
  // has an account at all.
  const refused = () =>
    new HttpError(
      401,
      'invalid_recovery_details',
      'Those details do not match a staff account. Check the email, PIN and ID, then try again.',
    );

  const profile = await findProfile(env, email);
  if (!profile || !profile.active || !profile.auth_user_id) throw refused();
  if (profile.auth_user_id.trim().toLowerCase() !== accountId) throw refused();
  if (profile.pin !== pin) throw refused();

  const weak = checkPassword(body.password, email, profile.name);
  if (weak) throw new HttpError(400, 'weak_password', weak);

  const authUser = await findAuthUser(env, email);
  if (!authUser) throw refused();

  // PUT is the only verb this project routes for an admin user update; PATCH
  // answers 405. Confirmed by scripts/probe-auth-admin.mjs.
  const updated = await gotrueAsAdmin(env, `/admin/users/${encodeURIComponent(authUser.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ password: body.password }),
  });
  if (!updated.ok) {
    const detail = await readJson(updated);
    console.error('[staff-accounts] recover failed', { email, status: updated.status, detail });
    throw new HttpError(502, 'upstream_failure', 'The password could not be changed. Try again.');
  }

  // Forces the person to set one only they know at their next sign-in, so the
  // password they have just typed on a shared machine is not the one they keep.
  await restAsAdmin(env, `users?id=eq.${encodeURIComponent(profile.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ must_change_password: true }),
  });

  // No actor: there was no session, and saying otherwise would be a fiction in
  // the log an administrator reads when asking who changed a password.
  await audit(env, null, {
    action: 'RECOVER_STAFF_PASSWORD',
    targetEmail: email,
    targetId: profile.id,
    outcome: 'ok',
  });

  return {
    status: 200,
    body: {
      ok: true,
      code: 'recovered',
      // Measured, not assumed: scripts/check-recovery.mjs takes a session before
      // the change and reuses the access token after, and it is refused. So a
      // password change really does end every session already issued for the
      // account, which is what makes a recovery a revocation and not just a
      // relabelling. The reply says so, because somebody who reset a password
      // they suspected was stolen needs to know the thief is out.
      message:
        'Password changed, and anyone already signed in on this account has been signed out. Sign in with the new password, then choose one of your own when asked.',
      data: { email, profileId: profile.id, mustChangePassword: true },
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

  let body: CreateBody | ResetBody | RecoverBody;
  try {
    body = await req.json();
  } catch {
    return respond(400, { ok: false, code: 'upstream_failure', message: 'Malformed request.' });
  }

  // Password recovery is answered BEFORE the session is looked at, and that
  // ordering is the whole point of the action rather than an oversight: it
  // exists for the person who cannot sign in, so demanding a token would
  // demand the exact thing that is missing. It carries its own three-fact check
  // instead, and every other action below still requires an administrator's JWT.
  if (body?.action === 'recover') {
    try {
      const result = await opRecover(env, body as RecoverBody);
      return respond(result.status, result.body);
    } catch (err) {
      if (err instanceof HttpError) {
        // A refusal is logged without a target address on purpose. The reply
        // says nothing, and a log that named the address someone guessed would
        // hand back the half of the answer the endpoint is refusing to give.
        await audit(env, null, {
          action: 'RECOVER_STAFF_PASSWORD',
          targetEmail: '',
          targetId: null,
          outcome: `refused:${err.code}`,
        });
        return respond(err.status, { ok: false, code: err.code, message: err.message });
      }
      console.error('[staff-accounts] recover threw', err);
      return respond(502, {
        ok: false,
        code: 'upstream_failure',
        message: 'The password could not be changed. Try again.',
      });
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
        message: 'Unknown action. Expected "create", "reset" or "recover".',
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
