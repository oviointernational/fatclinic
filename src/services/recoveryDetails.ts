/**
 * Reading your own account identifier, for password recovery.
 *
 * WHY THIS IS A SEPARATE MODULE
 * -----------------------------
 * `users.auth_user_id` is the secret half of the "forgotten password" check, so
 * it is not readable from the `users` table by a signed-in staff member - not
 * even one's own row. The database grants `authenticated` an explicit column
 * list that leaves it out, because a table-wide grant would have let any
 * clinician read the administrator's identifier and reset the administrator's
 * password.
 *
 * The one legitimate need for it is being able to *write it down*, which has to
 * happen while signed in, because the moment you need it is the moment you
 * cannot sign in. `app_own_account_id()` covers exactly that: it is
 * SECURITY DEFINER and resolves the value from the caller's own JWT email, so
 * there is no argument that could aim it at a colleague. It is the difference
 * between "readable by anyone on the ward" and "readable by you".
 *
 * A person who does not want to look in the app can read the same value in the
 * Supabase dashboard (Table Editor -> users -> auth_user_id), which is why the
 * recovery screen mentions both.
 */
import { getSupabase } from './supabase';

/**
 * The signed-in person's own account identifier, or null.
 *
 * Null is a normal answer, not an error: it means there is no session, no staff
 * profile, or no sign-in account yet. Each of those is a state where recovery
 * cannot work anyway, and none of them should put an error on the screen.
 */
export async function fetchOwnAccountId(): Promise<string | null> {
  const client = getSupabase();
  if (!client) return null;

  const { data, error } = await client.rpc('app_own_account_id');
  if (error) {
    // A deployment that has not applied the schema change yet has no such
    // function. That is worth saying out loud rather than showing a blank,
    // because the whole recovery flow depends on the person having the ID.
    console.warn('[recovery] could not read your own account ID:', error.message);
    return null;
  }

  const id = typeof data === 'string' ? data.trim() : '';
  return id || null;
}
