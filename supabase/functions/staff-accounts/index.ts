/**
 * Deno entry point for the `staff-accounts` Edge Function.
 *
 * Deliberately three lines of logic. Everything that matters lives in
 * `handler.ts` with the environment passed in as an argument, so the exact code
 * that runs in production can be executed by
 * `scripts/check-staff-accounts.mjs` under Node against the live project.
 *
 * The privileged key arrives as an Edge Function secret and is read here, never
 * in the handler, so there is one place that touches it and one line to audit:
 *
 *   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<value>
 */
import { handleStaffAccountRequest, type HandlerEnv } from './handler.ts';

Deno.serve((req: Request) => {
  const env: HandlerEnv = {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL') ?? '',
    SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  };
  return handleStaffAccountRequest(req, env);
});
