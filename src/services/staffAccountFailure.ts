/**
 * Why a staff account operation failed, and what to tell the person.
 *
 * WHY THIS IS NOT IN staffAccounts.ts
 * -----------------------------------
 * Same reason authFailure.ts is not in auth.ts: this module has to be runnable
 * under plain Node so it can be tested, and a file that reaches for the Supabase
 * client cannot be imported outside a bundler. Node resolves `./supabase` only if
 * the extension is written out, while Vite resolves it either way, so the two
 * cannot both be satisfied in one file. The impure half stays in
 * staffAccounts.ts and this half is what the tests import.
 *
 * That separation is not cosmetic here. The recovery path is where the statuses
 * collide: a wrong recovery fact comes back as 401, and 401 is also what an
 * expired session looks like. Getting that mapping wrong tells somebody who
 * cannot sign in to wait a minute and try their password again, which is the one
 * piece of advice that cannot help them. It is a bug worth pinning, and pinning
 * it needs the function to be importable.
 */

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
  /** A recovery attempt where the email, PIN and ID did not all match. */
  | 'invalid_recovery_details'
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

export const GENERIC =
  'The sign-in account could not be changed. Check your connection and try again.';

/**
 * Translate whatever came back into a reason and a sentence for a clinician.
 *
 * A missing deployment gets its own message on purpose. It is the single most
 * likely failure in a fresh install, and "Relay Error invoking the Edge
 * Function" is not something an administrator can act on.
 */
export function classifyStaffAccountFailure(
  status: number | undefined,
  code: string | undefined,
  fallback: string,
): StaffAccountResult {
  const message = (fallback || '').trim() || GENERIC;

  // The code is checked before the status, and that order is the whole reason
  // this function exists as a separate, tested unit. `invalid_recovery_details`
  // arrives as a 401 - the honest status for "these credentials did not match" -
  // and a status-first switch would report it as an expired session, telling
  // somebody locked out to wait a minute and try the password they cannot
  // remember. `missing_token` is the code that actually means an expired session.
  switch (code) {
    case 'missing_token':
      return { ok: false, reason: 'session-expired', message: 'Your session has expired. Sign in again.' };
    case 'invalid_recovery_details':
      return { ok: false, reason: 'invalid_recovery_details', message };
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
