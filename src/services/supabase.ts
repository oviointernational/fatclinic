/**
 * Supabase browser client.
 *
 * The anon key is designed to be public, so it is safe in the bundle ONLY
 * because database/rls.sql enables Row Level Security on every table. If you
 * ever remove RLS, this file hands every visitor full read/write access to all
 * patient data - do not ship that.
 *
 * The client is created lazily and is `null` when the environment variables are
 * absent, so a checkout without .env still boots in local-only mode rather than
 * crashing on a missing key.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

/** True when the browser has been pointed at a Supabase project. */
export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

if (isSupabaseConfigured) {
  client = createClient(url as string, anonKey as string, {
    auth: {
      // Supabase persists the session in localStorage by default; keep that so
      // a page refresh does not sign the clinician out mid-consultation.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

/**
 * The shared client, or null in local-only mode.
 *
 * Callers that need a guaranteed client should use requireSupabase() and handle
 * the error, so a misconfigured deployment fails loudly instead of silently
 * writing nothing.
 */
export function getSupabase(): SupabaseClient | null {
  return client;
}

export function requireSupabase(): SupabaseClient {
  if (!client) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY ' +
        '(see .env.example), then rebuild.'
    );
  }
  return client;
}
