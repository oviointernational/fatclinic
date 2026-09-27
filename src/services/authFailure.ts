/**
 * Why a sign-in failed, and what the clinician is told about it.
 *
 * WHY THIS IS A SEPARATE FILE
 * ---------------------------
 * `auth.ts` cannot be imported outside a bundler - it reaches `import.meta.env`
 * and pulls in the sync layer - so nothing in it can be tested. The rules here
 * are pure and are the part that decides what a clinician is shown at the moment
 * they are most likely to be in a hurry, so they live where a test can reach
 * them. See `npm run db:check-signin-locked`.
 *
 * THE RATE LIMIT IS NOT A WRONG PASSWORD
 * --------------------------------------
 * Supabase refuses a sign-in after roughly 15-18 failures on one account, and
 * from then on answers **the correct password** with the same
 * `invalid_credentials` a wrong one gets. Measured on this project:
 *
 *   - the limit is per account, not per address. One person's typos do not lock
 *     out the rest of the clinic, which matters because a clinic sits behind a
 *     single office NAT.
 *   - retyping the correct password does NOT clear it. Every retry re-arms it.
 *   - it clears itself within about a minute of stopping.
 *   - writing the password again clears it immediately.
 *
 * So a locked account reported as "Email or password is incorrect" is not a small
 * wording problem. It sends someone into a loop that cannot succeed and that
 * keeps them locked, and it is the reason a correct password was once believed
 * to have stopped working on its own.
 */

/** Why a sign-in did not produce a staff profile. */
export type AuthFailure =
  | 'not-configured'
  | 'invalid-credentials'
  /** Too many failed attempts. The password may well be right. */
  | 'too-many-attempts'
  | 'no-profile'
  | 'inactive'
  | 'unreachable';

/** The failure half on its own, so `auth.ts` can add its own `User` type. */
export type AuthFailureOutcome = {
  ok: false;
  reason: AuthFailure;
  message: string;
};

/** Generic so `auth.ts` narrows the success branch to the app's `User`. */
export type AuthOutcome<T = unknown> =
  | { ok: true; user: T }
  | AuthFailureOutcome;

/**
 * Copy shown to the clinician.
 *
 * `invalid-credentials` deliberately does not say which half was wrong: telling
 * an attacker whether an address is registered turns the sign-in form into an
 * account-enumeration oracle. A rate limit is a different thing and is safe to
 * name, because it says nothing about whether the address exists.
 */
export const MESSAGES: Record<AuthFailure, string> = {
  'not-configured':
    'This build is not connected to Supabase, so nobody can sign in. Set ' +
    'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then rebuild.',
  'invalid-credentials': 'Email or password is incorrect.',
  'too-many-attempts':
    'Too many failed sign-in attempts for this account. Your password is not the ' +
    'problem. Wait a minute without trying, then sign in once.',
  'no-profile':
    'Your sign-in was accepted, but there is no staff profile for this address. ' +
    'An administrator has to create one before you can use the workstation.',
  inactive: 'This staff account has been disabled. Contact Administration.',
  unreachable: 'Could not reach the sign-in service. Check the connection and try again.',
};

export const fail = (reason: AuthFailure): AuthFailureOutcome => ({
  ok: false,
  reason,
  message: MESSAGES[reason],
});

/**
 * Is this a rate limit rather than a rejected password?
 *
 * All three fields are checked because `supabase-js` does not pass the response
 * body through. It flattens it onto an `AuthError`, so a 429 arrives as
 * `status: 429` with `code` set to the *number* 429 rather than the string
 * `over_request_rate_limit` that GoTrue actually sent. A proxy reporting only
 * the code, or only the message, is covered too.
 *
 * The pattern cannot match a genuine rejection: a wrong password is answered
 * "Invalid login credentials", which contains none of these words. Getting this
 * backwards would show a wrong-password warning to a locked account and a lockout
 * warning to someone who simply mistyped, so both directions are pinned by a
 * test against the exact payloads this project returns.
 */
export function isRateLimited(status: number | undefined, error: unknown): boolean {
  if (status === 429) return true;
  const e = (error ?? {}) as { code?: unknown; error_code?: unknown; message?: unknown };
  const text = [e.error_code, e.code, e.message]
    .filter((v) => typeof v === 'string')
    .join(' ');
  return /rate.?limit|too.?many|security purposes/i.test(text);
}
