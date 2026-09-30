/**
 * The only place in the application that talks to the `staff-accounts` Edge
 * Function.
 *
 * WHY A FUNCTION INSTEAD OF A DIRECT CALL
 * --------------------------------------
 * Creating or resetting a Supabase Auth account needs the `service_role` key,
 * which bypasses every row-level security policy in the database. The browser
 * cannot be trusted with it - anyone who opened devtools would have the patient
 * table - so that key lives in the function's server-side secrets and never
 * crosses the wire toward the client.
 *
 * The function is not a general-purpose backend and does not sit in the path of
 * clinic data. Ordinary records still go straight from the browser to Postgres
 * through RLS, exactly as before. This handles the few operations that genuinely
 * require the privileged key, and nothing else.
 *
 * The request body is treated as a request, not as a claim: the function
 * decides permission from the caller's own verified JWT, so nothing this module
 * sends can make a non-administrator into one.
 */
import { getSupabase } from './supabase';

/** Why a staff account operation failed, in terms the UI can act on. */
export type StaffAccountFailure =
  /** This build has no Supabase connection, so there is no function to call. */
  | 'not-configured'
  /** The function has not been deployed to the project yet. */
  | 'function-missing'
  /** The session expired mid-request. */
  | 'session-expired'
  /** The signed-in user is not an active administrator. */
  | 'not-admin'
  /** The address has no staff profile, so no account should exist for it. */
  | 'no_staff_profile'
  /** An account already exists, so "create" is the wrong operation. */
  | 'account_exists'
  /** No account exists, so "reset" is the wrong operation. */
  | 'no_auth_account'
  /** Another account already signs in with the address being moved. */
  | 'email_taken'
  | 'invalid_email'
  | 'weak_password'
  | 'unreachable';

export type StaffAccountResult =
  | { ok: true; message: string }
  | {
      ok: false;
      reason: StaffAccountFailure;
      message: string;
      /**
       * Set when the caller asked for the wrong operation, so the dialog can
       * offer the right one instead of making the administrator work out why
       * "reset" refused an account that has never been created.
       */
      suggests?: 'create' | 'reset';
    };

const GENERIC =
  'The sign-in account could not be changed. Check your connection and try again.';

/**
 * Translate whatever came back into a reason and a sentence for a clinician.
 *
 * A genuinely missing deployment - the gateway answering 404 for the
 * function's own name - gets its own message on purpose: "Relay Error
 * invoking the Edge Function" is not something an administrator can act on.
 * Reachability problems are diagnosed in `invokeOnce` instead, so this only
 * sees a 404 when the function is really absent.
 */
function classify(status: number | undefined, code: string | undefined, fallback: string): StaffAccountResult {
  const message = (fallback || '').trim() || GENERIC;

  switch (code) {
    case 'missing_token':
      return { ok: false, reason: 'session-expired', message: 'Your session has expired. Sign in again.' };
    case 'not_admin':
      return { ok: false, reason: 'not-admin', message };
    case 'no_staff_profile':
      return { ok: false, reason: 'no_staff_profile', message };
    case 'account_exists':
      return {
        ok: false,
        reason: 'account_exists',
        message,
        suggests: 'reset',
      };
    case 'no_auth_account':
      return {
        ok: false,
        reason: 'no_auth_account',
        message,
        suggests: 'create',
      };
    case 'invalid_email':
      return { ok: false, reason: 'invalid_email', message };
    case 'email_taken':
      return { ok: false, reason: 'email_taken', message };
    case 'weak_password':
      return { ok: false, reason: 'weak_password', message };
    default:
      break;
  }

  if (status === 401) return { ok: false, reason: 'session-expired', message: 'Your session has expired. Sign in again.' };
  if (status === 403) return { ok: false, reason: 'not-admin', message };
  if (status === 404) {
    return {
      ok: false,
      reason: 'function-missing',
      message:
        'This feature runs as a Supabase Edge Function that has not been deployed yet. ' +
        'An administrator can deploy it with: supabase functions deploy staff-accounts',
    };
  }
  return { ok: false, reason: 'unreachable', message: message || GENERIC };
}

/** The function's own JSON shape, from handler.ts. */
type FunctionReply = { ok: boolean; code?: string; message?: string };

/**
 * What the function accepts, one shape per operation.
 *
 * `change_email` is named by profile id rather than by the address, because the
 * address is the thing being changed - the caller has to say which person it
 * is about, and the only stable way to say that is the profile's own id.
 */
type StaffAccountRequest =
  | { action: 'create'; email: string; password: string }
  | { action: 'reset'; email: string; password: string }
  | { action: 'change_email'; userId: string; email: string };

/**
 * How many times the function is asked before a transient failure is reported.
 *
 * Free-tier projects put their Edge Function buckets to sleep; the first call
 * after idle can 503 or stall while the bucket wakes up. One retry after a
 * short pause usually succeeds, and beats making an administrator diagnose a
 * cold start.
 */
const MAX_ATTEMPTS = 2;
const RETRY_AFTER_MS = 900;

/**
 * One attempt at invoking the function.
 *
 * Returns the result to show, plus whether the failure was *temporary* (a
 * network problem or a 5xx cold-start wake-up) and worth retrying. Handler
 * refusals come back signed with a `code` and are never retried - they will
 * not change on a second attempt.
 */
async function invokeOnce(
  client: NonNullable<ReturnType<typeof getSupabase>>,
  body: StaffAccountRequest,
): Promise<{ result: StaffAccountResult; transient: boolean }> {
  let payload: FunctionReply | null = null;
  let response: Response | null = null;

  try {
    // The signed-in clinician's JWT is attached automatically by supabase-js,
    // so the function learns who is calling from the token and not the body.
    const { data, error } = await client.functions.invoke('staff-accounts', { body });

    if (!error) {
      payload = (data ?? null) as FunctionReply | null;
      if (payload?.ok) return { result: { ok: true, message: payload.message ?? 'Done.' }, transient: false };
      return { result: classify(500, payload?.code, payload?.message ?? ''), transient: false };
    }

    // A non-2xx still carries the function's own explanation, and it is far
    // more useful than the SDK's generic text, so the body is read back out.
    const context = (error as { context?: unknown }).context;
    response = context instanceof Response ? context : null;
    if (response) {
      try {
        payload = (await response.clone().json()) as FunctionReply;
      } catch {
        payload = null;
      }
    }

    // Every handler refusal is signed with a `code`; interpret it directly.
    if (payload?.code) {
      return { result: classify(response?.status, payload.code, payload.message ?? ''), transient: false };
    }

    // Only a genuine gateway 404 for the function's own name means "not
    // deployed" - and that is a real finding, worth its own fixable message.
    // Everything else without a handler reply (network failure, DNS, timeout,
    // a 5xx from a bucket that is still waking up) is a reachability problem,
    // not a missing deployment, and is retried once before being reported.
    const status = response?.status;
    if (status === 404) {
      return { result: classify(404, undefined, ''), transient: false };
    }

    const temporary =
      error.name === 'FunctionsFetchError' || (status !== undefined && status >= 500);
    if (temporary) {
      return {
        result: {
          ok: false,
          reason: 'unreachable',
          message:
            'The sign-in service did not answer. It may be waking up, or your connection to it is ' +
            'down - check your connection and try again.',
        },
        transient: true,
      };
    }

    return { result: { ok: false, reason: 'unreachable', message: GENERIC }, transient: false };
  } catch (err) {
    // A thrown error here is a network or DNS failure, not a refusal - the
    // same family as FunctionsFetchError, and worth the same single retry.
    console.error('[staff-accounts] invocation threw:', err);
    return {
      result: {
        ok: false,
        reason: 'unreachable',
        message: 'The sign-in service did not answer. Check your connection and try again.',
      },
      transient: true,
    };
  }
}

async function call(body: StaffAccountRequest): Promise<StaffAccountResult> {
  const client = getSupabase();
  if (!client) {
    return {
      ok: false,
      reason: 'not-configured',
      message: 'This build is not connected to Supabase, so staff accounts cannot be managed here.',
    };
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { result, transient } = await invokeOnce(client, body);
    if (!transient || attempt === MAX_ATTEMPTS) return result;
    await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
  }

  return { ok: false, reason: 'unreachable', message: GENERIC };
}

/**
 * Create the sign-in account for a staff profile that has already been saved.
 *
 * The profile is written through the ordinary RLS-protected path first, and only
 * this step is privileged. That order is deliberate: if it fails, the leftover
 * is a profile with no account, which is inert and can simply be tried again.
 * The reverse would leave a live credential nobody has a profile for.
 */
export function createStaffAccount(email: string, password: string): Promise<StaffAccountResult> {
  return call({ action: 'create', email: email.trim().toLowerCase(), password });
}

/**
 * Set a new password for someone who has forgotten theirs.
 *
 * Refuses rather than creating an account when none exists, because "reset"
 * implies an account already existed; quietly minting a new credential would
 * hide a provisioning mistake behind a success message.
 */
export function resetStaffPassword(email: string, password: string): Promise<StaffAccountResult> {
  return call({ action: 'reset', email: email.trim().toLowerCase(), password });
}

/**
 * Change the address a staff member signs in with.
 *
 * Called only when the person already has an account. For somebody without one
 * there is nothing privileged about an address change - the profile's `email`
 * column is an ordinary field an administrator can edit through RLS - so the
 * dashboard still edits that one directly and never pays for a round trip.
 *
 * WHY IT CANNOT BE LEFT TO THE RLS WRITE
 * ---------------------------------------
 * The sign-in address exists in two places, and only one of them is an ordinary
 * column: `public.users.email`, which any administrator can write, and the
 * Supabase Auth account, which needs the privileged key this function holds.
 * Changing the first alone leaves the second pointing at the old address, and
 * because every RLS predicate in this database resolves identity by
 * `auth.jwt() ->> 'email'` against `users.email` (see database/fatclinic.sql),
 * that does not merely stop them signing in again - it stops their existing
 * session from matching their own profile row at all.
 */
export function changeStaffEmail(userId: string, email: string): Promise<StaffAccountResult> {
  return call({ action: 'change_email', userId: userId.trim(), email: email.trim().toLowerCase() });
}
