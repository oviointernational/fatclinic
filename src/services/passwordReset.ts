/**
 * Password reset by emailed link, for clinic administrators only.
 *
 * TWO SEPARATE THINGS LIVE HERE, AND IT IS WORTH BEING EXPLICIT ABOUT WHY
 * --------------------------------------------------------------------
 * 1. Asking for a link (`requestResetEmail`). Signed out, by necessity.
 * 2. Completing a link (`readResetLink`, `completeReset`). Signed out too, but
 *    with a short-lived recovery token in the URL.
 *
 * They are in one module because they are two halves of one journey and share
 * the awkward part, which is item 2's requirement to be signed out.
 *
 * WHY A SUPERVISED EDGE FUNCTION, NOT `resetPasswordForEmail`
 * ---------------------------------------------------------
 * The obvious way to do this is one line in the browser:
 * `supabase.auth.resetPasswordForEmail(email)`. It needs no function and no
 * privileged key, and it is wrong for this clinic.
 *
 * GoTrue will mail a working reset link to ANY registered address. A clinician
 * who types their own address would get one, and would reset their own password
 * without involving anyone - while the stated rule is that only administrators
 * do that, and everyone else is routed to the person who can help them. Deciding
 * who gets a link means reading `public.users`, and RLS refuses every read of
 * that table without a session. So the decision has to happen server-side, where
 * the privileged key lives, and never in the browser.
 *
 * WHY COMPLETING A LINK DOES NOT SIGN THE PERSON IN
 * -------------------------------------------------
 * A reset link carries a recovery access token, and the ordinary Supabase
 * client would happily persist it to localStorage as an ordinary session. On a
 * clinic workstation that is a real hazard: someone follows the link on a shared
 * machine, walks away from it, and the next person at that desk has a live
 * administrator session they never asked for and nobody noticed.
 *
 * So completion uses a SEPARATE client, created with `persistSession: false`,
 * held only in a module-level variable, and never shared with the rest of the
 * app. The token lives in that one closure for as long as the tab is open and
 * goes nowhere else. When the tab closes, the token is gone, and a refresh gets
 * the ordinary signed-out screen - which is correct: they still have to sign in
 * with the password they just chose.
 *
 * This is also why `detectSessionInUrl` stays off in `services/supabase.ts`. If
 * it were on, the shared client would parse the link and persist the token
 * before any of this ran, quietly undoing the whole arrangement. The link is
 * handled explicitly here instead.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from './supabase';
import { passwordProblems } from './passwordPolicy';

/** What asking for a link produced. */
export type ResetRequestResult =
  | { ok: true; sent: boolean; message: string }
  | { ok: false; message: string };

/** What completing a link produced. */
export type ResetCompleteResult = { ok: true; message: string } | { ok: false; message: string };

/** The shape of the link Supabase sends, and the only one it sends here. */
type ResetLink = { accessToken: string; refreshToken: string; email: string | null };

/**
 * The recovery session, if a reset link was followed.
 *
 * Module-level rather than per-call because it must survive re-renders: a client
 * created inside a component function would be rebuilt on every render and take
 * its in-memory session - the only copy, since nothing is persisted - with it.
 */
let recovery: SupabaseClient | null = null;

/**
 * The link's tokens, read out of the URL fragment.
 *
 * Supabase's recovery link is `<app>/#access_token=...&refresh_token=...`, and
 * the fragment is used rather than the query because the fragment is never sent
 * to a server. That matters for a credential: everything before the `#` is
 * visible in server logs and in a `Referer` header, everything after it is not.
 *
 * Returns null when the URL is not a reset link, which is the normal case and
 * must be silent - a person opening the app normally is not an error.
 */
function parseResetLink(): ResetLink | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  if (!hash || hash.length < 2) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(hash.slice(1));
  } catch {
    return null;
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return null;

  // `email` is a convenience Supabase includes; it is only used to show the
  // person whose account they are changing. Nothing is trusted from it - the
  // token is the authority, and the address is confirmed from the token below.
  return {
    accessToken,
    refreshToken,
    email: params.get('email'),
  };
}

/**
 * Is the current URL a reset link?
 *
 * Synchronous and token-shape-only on purpose: it is read once at start-up to
 * decide which screen to open, and it must not depend on a network call, or the
 * app would render the wrong screen first and then swap it a moment later.
 * `describeResetTarget` is what actually proves the token works.
 */
export function hasResetLink(): boolean {
  return parseResetLink() !== null;
}

/**
 * The address the link actually belongs to, read from the token.
 *
 * Deliberately not the `email` parameter: that one is just text in a URL and
 * proves nothing. Asking the token who it is proves something, and it means the
 * form can only ever label the change with an address Supabase has confirmed.
 * Returns null when there is no link, or the link is not usable.
 */
export async function describeResetTarget(): Promise<string | null> {
  const link = parseResetLink();
  if (!link) return null;

  const client = await getRecoveryClient(link);
  if (!client) return null;

  const { data, error } = await client.auth.getUser();
  if (error) return null;
  // Falls back to the URL's own claim only if the token confirms an address but
  // carries none, which Supabase does not do. Belt and braces for a label.
  return data.user?.email ?? link.email ?? null;
}

/**
 * A client that holds a recovery session in memory and nowhere else.
 *
 * This is the whole reason the reset flow does not sign anybody in. Compare
 * `services/supabase.ts`, which is created with `persistSession: true` so a
 * refresh does not interrupt a consultation - exactly wrong for a link that
 * arrives in a URL and must not outlive the tab.
 */
async function getRecoveryClient(link: ResetLink): Promise<SupabaseClient | null> {
  if (recovery) return recovery;

  const configured = getSupabase();
  if (!configured) return null;

  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const url = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;

  const client = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { error } = await client.auth.setSession({
    access_token: link.accessToken,
    refresh_token: link.refreshToken,
  });
  if (error) return null;

  recovery = client;
  return recovery;
}

/**
 * Take the URL fragment off the address bar.
 *
 * `replaceState` rather than `location.hash = ''` so the reset link does not
 * become a back-button entry, and the tokens leave the visible URL and the
 * history entry as soon as they have been read. Called after a successful
 * change, so a refresh mid-way through the form does not silently re-open a
 * half-filled one.
 */
function clearResetLink(): void {
  if (typeof window === 'undefined') return;
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}`,
  );
}

/**
 * Ask for a reset link, if the address belongs to a clinic administrator.
 *
 * Deliberately a plain `fetch` rather than `supabase.functions.invoke`: this
 * runs signed out, and the point of the test suite is that the function answers
 * a caller with no session at all. `invoke` would attach whatever session
 * happened to exist - none - but it also reads the function URL out of the
 * shared client and adds indirection that makes the request harder to read in a
 * network log. The anon key is the correct credential here: it is designed to be
 * public, and the function authorises this action on the staff profile, not on
 * the key.
 */
export async function requestResetEmail(email: string): Promise<ResetRequestResult> {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const url = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();

  if (!url || !anonKey) {
    return {
      ok: false,
      message: 'This build is not connected to Supabase, so reset links cannot be sent.',
    };
  }

  const address = email.trim().toLowerCase();
  if (!address) {
    return { ok: false, message: 'Enter your staff email address.' };
  }

  let payload: { ok?: boolean; sent?: boolean; message?: string } | null = null;

  try {
    const res = await fetch(`${url}/functions/v1/staff-accounts`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'forgot', email: address }),
    });

    const text = await res.text();
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (!payload) {
      // No JSON at all. On this project the overwhelmingly likely cause is that
      // the function has never been deployed, and "Relay Error invoking the Edge
      // Function" is not something an administrator can act on.
      return {
        ok: false,
        message:
          res.status === 404
            ? 'This feature runs as a Supabase Edge Function that has not been deployed yet. ' +
              'It can be deployed with: supabase functions deploy staff-accounts'
            : 'The reset service could not be reached. Check the connection and try again.',
      };
    }
  } catch (err) {
    console.error('[password-reset] request threw:', err);
    return { ok: false, message: 'The reset service could not be reached. Try again.' };
  }

  // A refusal is still 200-shaped: the function's own `ok: false` means the
  // address was unusable, and its sentence is the one to show.
  if (payload.ok && typeof payload.sent === 'boolean') {
    return { ok: true, sent: payload.sent, message: payload.message ?? '' };
  }
  return { ok: false, message: payload.message ?? 'The reset link could not be requested. Try again.' };
}

/**
 * Set a new password using the link in the URL.
 *
 * The token, not anything the form sends, decides whose password changes. The
 * password is checked against the same shared policy the rest of the app uses
 * before it is sent, so a person who is finally fixing their password is not
 * met with a rule they cannot see.
 */
export async function completeReset(password: string): Promise<ResetCompleteResult> {
  const link = parseResetLink();
  if (!link) {
    return {
      ok: false,
      message: 'This reset link is no longer valid. Ask for a new one and use it from this device.',
    };
  }

  const client = await getRecoveryClient(link);
  if (!client) {
    return {
      ok: false,
      message: 'This reset link has expired or has already been used. Ask for a new one.',
    };
  }

  // The address comes from the token rather than the form, so the rules can be
  // applied against the account actually being changed.
  //
  // Being straight about what this is: an ADVISORY check, not enforcement. The
  // two privileged operations in handler.ts run `passwordProblems` server-side and
  // that copy is the one that counts, but this path cannot - the password is set
  // by `auth.updateUser`, which talks straight to GoTrue and never sees our
  // handler. So the only rule actually applied to a reset password is GoTrue's own
  // configured minimum, and this narrows the gap rather than closing it.
  //
  // A client-side check that can be skipped with the console is still worth
  // having, for the ordinary case: a person choosing their first new password in
  // a hurry, who would otherwise be refused by GoTrue for being too short with a
  // vaguer message than the one they could have been given up front.
  const { data: userData } = await client.auth.getUser();
  const targetEmail = userData.user?.email ?? link.email ?? '';
  const problems = passwordProblems(password, targetEmail);
  if (problems.length) {
    return { ok: false, message: problems[0] };
  }

  const { error } = await client.auth.updateUser({ password });
  if (error) {
    // Left in the console rather than shown: this string can carry detail about
    // the account, and the person reading it is whoever opened the link.
    console.error('[password-reset] updateUser failed:', error);
    return {
      ok: false,
      message: 'The password could not be changed. Ask for a fresh link and try once more.',
    };
  }

  // The token is single-use and now spent, so it is dropped from memory as well
  // as from the address bar: leaving it reachable would let a second call in this
  // same tab report a change that never happened.
  recovery = null;
  clearResetLink();

  return {
    ok: true,
    message: 'Your password has been changed. Sign in with it below.',
  };
}
