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
 * through RLS, exactly as before. This handles the two operations that genuinely
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
 * A missing deployment gets its own message on purpose. It is the single most
 * likely failure in a fresh install, and "Relay Error invoking the Edge
 * Function" is not something an administrator can act on.
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

async function call(body: { action: 'create' | 'reset'; email: string; password: string }): Promise<StaffAccountResult> {
  const client = getSupabase();
  if (!client) {
    return {
      ok: false,
      reason: 'not-configured',
      message: 'This build is not connected to Supabase, so staff accounts cannot be managed here.',
    };
  }

  let payload: FunctionReply | null = null;

  try {
    // The signed-in clinician's JWT is attached automatically by supabase-js, so
    // the function learns who is calling from the token and not from the body.
    const { data, error } = await client.functions.invoke('staff-accounts', { body });

    if (error) {
      // A non-2xx still carries the function's own explanation, and it is far
      // more useful than the SDK's generic text, so the body is read back out.
      const context = (error as { context?: unknown }).context;
      if (context instanceof Response) {
        try {
          payload = (await context.clone().json()) as FunctionReply;
        } catch {
          payload = null;
        }
      }
      if (payload) {
        return classify(context instanceof Response ? context.status : undefined, payload.code, payload.message ?? '');
      }
      // No body at all. A relay or fetch error is overwhelmingly the function
      // not being deployed, and saying so is the difference between a fixable
      // message and a dead end.
      if (error.name === 'FunctionsRelayError' || error.name === 'FunctionsFetchError') {
        return classify(404, undefined, '');
      }
      return { ok: false, reason: 'unreachable', message: GENERIC };
    }

    payload = (data ?? null) as FunctionReply | null;
    if (payload?.ok) return { ok: true, message: payload.message ?? 'Done.' };
    return classify(500, payload?.code, payload?.message ?? '');
  } catch (err) {
    // A thrown error here is a network or DNS failure, not a refusal.
    console.error('[staff-accounts] invocation threw:', err);
    return { ok: false, reason: 'unreachable', message: GENERIC };
  }
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
