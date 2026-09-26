/**
 * Credentials: Supabase Auth, and nothing else.
 *
 * WHY THERE IS NO LOCAL PASSWORD
 * -----------------------------
 * The previous build compared a typed password against `user.password` held in
 * localStorage, and `fatclinic_active_user` in localStorage WAS the session -
 * any visitor could type one key into devtools and become whoever they liked.
 * It also shipped the credential itself: `FatClinic123` was a literal in
 * `seedData.ts`, which means it was in the JavaScript bundle, readable by
 * everyone who loaded the page, and unrotatable without a redeploy.
 *
 * Supabase Auth fixes both halves. It hashes credentials, rate-limits guessing,
 * supports rotation and revocation from the dashboard, and - the part that
 * matters most here - the app cannot obtain a session without a real password.
 *
 * THE OTHER HALF OF THE LOCK
 * --------------------------
 * A valid session is necessary but not sufficient. This module also requires an
 * `active` row in `public.users`, and destroys the session when there isn't one.
 * That check is duplicated in SQL (`app_user_role()` returns NULL for an
 * unrecognised or disabled account) because the browser is not a trust boundary:
 * the client check is what stops the *app* from showing a ward's records to a
 * stale account, and the SQL helper is what stops the *database* from serving
 * them. Both must stay.
 *
 * The anon key in the bundle cannot create an account, and cannot read anything
 * on its own - RLS admits only `authenticated` rows, and email self-signup is
 * switched off in the Supabase dashboard. Those two settings are the only thing
 * between a stranger and the patient table; changing either is an incident.
 */
import type { Session } from '@supabase/supabase-js';
import type { User } from '../types';
import { getSupabase } from './supabase';
import { TABLE_BY_KEY, USERS_STORAGE_KEY } from './sync';

/** Why a sign-in did not produce a staff profile. */
export type AuthFailure =
  | 'not-configured'
  | 'invalid-credentials'
  | 'no-profile'
  | 'inactive'
  | 'unreachable';

export type AuthOutcome =
  | { ok: true; user: User }
  | { ok: false; reason: AuthFailure; message: string };

/**
 * Copy shown to the clinician.
 *
 * `invalid-credentials` deliberately does not say which half was wrong: telling
 * an attacker whether an address is registered turns the sign-in form into an
 * account-enumeration oracle.
 */
const MESSAGES: Record<AuthFailure, string> = {
  'not-configured':
    'This build is not connected to Supabase, so nobody can sign in. Set ' +
    'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then rebuild.',
  'invalid-credentials': 'Email or password is incorrect.',
  'no-profile':
    'Your sign-in was accepted, but there is no staff profile for this address. ' +
    'An administrator has to create one before you can use the workstation.',
  inactive: 'This staff account has been disabled. Contact Administration.',
  unreachable: 'Could not reach the sign-in service. Check the connection and try again.',
};

const fail = (reason: AuthFailure): AuthOutcome => ({ ok: false, reason, message: MESSAGES[reason] });

/** The `users` row mapper, reused so a session and a hydrated row agree exactly. */
const usersMap = TABLE_BY_KEY.get(USERS_STORAGE_KEY);

/**
 * Fetch the staff profile for a signed-in session.
 *
 * Matching is case-insensitive, because `uq_users_email_lower` is unique on
 * `lower(email)` and staff type whatever case they were given. The filter is an
 * `ilike` and the exact match is then re-applied in JS, which is deliberate: `_`
 * is a single-character wildcard in `ilike` and is a legal character in an email
 * address, so `ilike` alone can return a neighbour. Every writer goes through
 * `modelToRow`, which lowercases, so an exact match is always present if the row
 * exists.
 */
async function fetchProfile(email: string): Promise<{ row?: Record<string, any>; failure?: AuthFailure }> {
  const client = getSupabase();
  if (!client) return { failure: 'not-configured' };

  let result;
  try {
    result = await client
      .from('users')
      .select('*')
      .ilike('email', email)
      .limit(5);
  } catch (err) {
    // A thrown fetch means the network or DNS failed, not that the row is absent.
    console.error('[auth] could not reach Supabase:', err);
    return { failure: 'unreachable' };
  }

  const { data, error } = result as { data: unknown; error: { message: string } | null };
  if (error) {
    console.error('[auth] staff profile lookup failed:', error.message);
    return { failure: 'unreachable' };
  }

  const rows = (data ?? []) as Record<string, any>[];
  const row = rows.find((r) => String(r.email ?? '').trim().toLowerCase() === email);
  if (!row) return { failure: 'no-profile' };
  if (!row.active) return { failure: 'inactive' };
  return { row };
}

/**
 * Verify credentials and resolve the staff profile behind them.
 *
 * On any failure the Supabase session is destroyed before returning. That is the
 * important part: a half-signed-in state - valid JWT, no profile - would still
 * satisfy the `authenticated` role and could read the patient table directly,
 * bypassing this app entirely.
 */
export async function signIn(email: string, password: string): Promise<AuthOutcome> {
  const client = getSupabase();
  if (!client) return fail('not-configured');

  const address = email.trim().toLowerCase();
  if (!address || !password) {
    return { ok: false, reason: 'invalid-credentials', message: 'Enter your staff email and password.' };
  }

  let data;
  let error;
  try {
    ({ data, error } = await client.auth.signInWithPassword({ email: address, password }));
  } catch (err) {
    console.error('[auth] sign-in threw:', err);
    return fail('unreachable');
  }

  if (error || !data?.user) {
    console.warn('[auth] sign-in rejected:', error?.message);
    return fail('invalid-credentials');
  }

  const profile = await resolveProfile(data.user.email ?? address);
  if (!profile.ok) {
    // Drop the session before it can be used for anything.
    await client.auth.signOut().catch(() => undefined);
    return profile;
  }
  return profile;
}

/**
 * Turn a session into a staff profile, or explain the refusal.
 *
 * Shared by sign-in and by boot-time session restore, so both paths enforce the
 * same rule. Never leaves a usable session behind on failure.
 */
export async function resolveProfile(sessionEmail: string): Promise<AuthOutcome> {
  const email = sessionEmail.trim().toLowerCase();
  if (!email) return fail('no-profile');

  const { row, failure } = await fetchProfile(email);
  if (!row) return fail(failure ?? 'no-profile');

  if (!usersMap) {
    // Unreachable in practice: the key is a literal in this module's own import.
    // Failing loudly beats handing back a half-built object.
    console.error('[auth] the users table map is missing from TABLES');
    return fail('no-profile');
  }

  return { ok: true, user: usersMap.rowToModel(row) as User };
}

/** The current session, or null. Resolves from localStorage; no network call. */
export async function getSession(): Promise<Session | null> {
  const client = getSupabase();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session ?? null;
}

/** End the session. Local failures are logged, never thrown at the caller. */
export async function signOut(): Promise<void> {
  const client = getSupabase();
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) console.error('[auth] sign-out failed:', error.message);
}

export type PasswordChange =
  | { ok: true }
  | { ok: false; kind: 'message'; message: string }
  | { ok: false; kind: 'needs-nonce'; message: string };

const REAUTH_RE = /reauth|re-auth|secure password change|nonce/i;

/**
 * Change the signed-in user's own password.
 *
 * Staff being able to rotate their own credential is the most important
 * account control there is, and it belongs here rather than in an admin screen:
 * an administrator resetting somebody's password has to be able to read it aloud
 * over a ward telephone, whereas nobody else ever needs to know it.
 *
 * A project with "Secure password change" enabled will refuse the first attempt
 * and require a one-time code emailed to the account. That is reported as
 * `needs-nonce` rather than as a failure, because the difference between "your
 * new password was rejected" and "prove it is really you, we emailed you a code"
 * decides whether the user retries or waits for an email. The nonce is sent
 * automatically on the first refusal, so the user is not left guessing.
 */
export async function changePassword(newPassword: string, nonce?: string): Promise<PasswordChange> {
  const client = getSupabase();
  if (!client) return { ok: false, kind: 'message', message: MESSAGES['not-configured'] };

  if (newPassword.length < 8) {
    return { ok: false, kind: 'message', message: 'Choose a password of at least 8 characters.' };
  }

  const { error } = await client.auth.updateUser(nonce ? { password: newPassword, nonce } : { password: newPassword });
  if (!error) return { ok: true };

  console.warn('[auth] password change rejected:', error.message);
  if (!REAUTH_RE.test(error.message)) {
    return {
      ok: false,
      kind: 'message',
      message: 'The password could not be changed. Contact Administration.',
    };
  }

  // Already holding a code and it still failed: the code is wrong or expired, so
  // send another one rather than looping on the same value.
  if (!nonce) {
    const sent = await requestReauthNonce();
    return {
      ok: false,
      kind: 'needs-nonce',
      message: sent
        ? 'For security, confirm the code we just emailed to your staff address, then choose the new password.'
        : 'This project requires email confirmation to change a password, and the code could not be sent. Contact Administration.',
    };
  }

  return { ok: false, kind: 'needs-nonce', message: 'That code was not accepted. We have emailed a new one - try again.' };
}

/**
 * Ask Supabase to email a re-authentication code.
 *
 * Returns whether the request was accepted, not whether the email arrived; there
 * is no way to know the second from here, and claiming otherwise would be a lie
 * shown to a clinician who then waits forever for a message that was rate
 * limited.
 */
export async function requestReauthNonce(): Promise<boolean> {
  const client = getSupabase();
  if (!client) return false;
  const { error } = await client.auth.reauthenticate();
  if (error) {
    console.warn('[auth] could not send a re-authentication code:', error.message);
    return false;
  }
  return true;
}

/**
 * Subscribe to session changes.
 *
 * The callback is scheduled on a macrotask rather than run inline. Supabase
 * invokes this handler while holding an internal lock, and awaiting another
 * Supabase call inside it deadlocks; `setTimeout` gets the work outside that
 * window. `SIGNED_OUT` is the only event that needs handling synchronously, and
 * it is handled by clearing state, not by calling Supabase.
 */
export function onAuthChange(handler: (session: Session | null) => void): () => void {
  const client = getSupabase();
  if (!client) return () => undefined;

  const { data } = client.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => handler(session), 0);
  });
  return () => data.subscription.unsubscribe();
}
