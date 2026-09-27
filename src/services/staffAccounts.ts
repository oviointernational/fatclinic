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
import {
  classifyStaffAccountFailure,
  GENERIC,
  type StaffAccountFailure,
  type StaffAccountResult,
} from './staffAccountFailure';

// Re-exported so existing imports keep working from one place. The logic lives
// in staffAccountFailure.ts because it has to be testable outside a bundler.
export type { StaffAccountFailure, StaffAccountResult } from './staffAccountFailure';

const classify = classifyStaffAccountFailure;

/** The function's own JSON shape, from handler.ts. */
type FunctionReply = { ok: boolean; code?: string; message?: string };

async function call(body: Record<string, unknown>): Promise<StaffAccountResult> {
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

/**
 * Set a new password with no session, for someone who cannot sign in.
 *
 * All three of the address, the workstation PIN and the account's own ID must
 * match. Only the third is a secret: the PIN is readable by any member of staff
 * (the app has to compare it in the browser to unlock a screen) and the address
 * is not secret at all, so the check is one factor deep and that factor is the
 * ID. See opRecover in the function for the full reasoning, and the README for
 * where to find the ID.
 *
 * Sent through the same client as the other two calls, which means supabase-js
 * attaches a session when there is one. That is harmless and deliberate: it
 * makes the row in the audit log say whether the person who recovered the
 * password was already signed in, instead of guessing.
 */
export function recoverStaffPassword(
  email: string,
  pin: string,
  id: string,
  password: string,
): Promise<StaffAccountResult> {
  return call({
    action: 'recover',
    email: email.trim().toLowerCase(),
    pin: pin.trim(),
    id: id.trim().toLowerCase(),
    password,
  });
}
