/**
 * Is the staff-accounts Edge Function actually live, and does it refuse the
 * privileged actions to a caller who cannot sign in?
 *
 * A deployed function answers. An undeployed one answers 404 with
 * {"message":"Edge Function \"staff-accounts\" not found"}. Neither needs
 * the service_role key, so this is safe to run any time.
 *
 * WHY THE GATEWAY IS NO LONGER THE THING BEING PROVEN
 * --------------------------------------------------
 * This check used to assert that the *gateway* rejected an unauthenticated POST
 * with a 401, which was the point while `verify_jwt = true` and every action
 * needed a signed-in administrator.
 *
 * `verify_jwt` is now `false` (see supabase/config.toml, and the "Forgotten
 * password" section of the README for why the need and the check were directly
 * opposed). The gateway no longer stops anything, so that assertion here would
 * now pass or fail for a reason that has nothing to do with whether the clinic is
 * safe. What matters now is the *handler's* refusal, which is strictly stronger:
 * it resolves the bearer token, looks the address up in public.users, and
 * requires an active ADMINISTRATOR. That is the check below.
 *
 * The distinction is kept explicit rather than dropped, because it is exactly the
 * distinction someone reading an audit log will ask about later. The gateway's
 * codes are uppercase `UNAUTHORIZED_*`; the handler's are lowercase snake_case
 * like `missing_token`. A 401 with `missing_token` is the handler refusing, which
 * is correct and intended. A 401 with `UNAUTHORIZED_*` would mean the gateway is
 * still verifying and this file's comment is out of date.
 *
 * `forgot` is the one action that must NOT be refused without a session, so it is
 * checked here too: the same unauthenticated caller that is refused `create` must
 * be answered by `forgot`. If someone ever re-enables `verify_jwt`, this is the
 * check that fails - which is the right outcome, because the feature would be dead
 * for exactly the people it exists for.
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return i === -1 ? [l.trim(), ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const URL_BASE = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const FN = `${URL_BASE}/functions/v1/staff-accounts`;

let failures = 0;
const check = (label, pass, detail = '') => {
  if (!pass) failures++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

async function probe(label, headers, body) {
  const r = await fetch(FN, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 160) };
  }
  console.log(`\n  ${label}`);
  console.log(`    status ${r.status}   ${JSON.stringify(json).slice(0, 200)}`);
  return { status: r.status, json };
}

const CRED = { apikey: ANON, 'Content-Type': 'application/json' };
const FORGED = { ...CRED, Authorization: 'Bearer not.a.real.jwt' };

console.log(`Probing ${FN}\n`);

// The privileged action, from nobody. This is the refusal that has to hold.
const noAuth = await probe('no Authorization header, asking to create an account', CRED, { action: 'create' });
const forged = await probe('a forged token, asking to create an account', FORGED, { action: 'create' });

// The one action that must be answered without a session.
const forgot = await probe(
  'no Authorization header, asking for a reset link for a non-address',
  CRED,
  { action: 'forgot', email: 'not-an-address' },
);

// `change_email` joined `create` and `reset` after an administrator changed a
// staff address on a profile that already had an account: the RLS write moved
// one half of the sign-in identity and left the other behind, so resetting that
// person afterwards looked like they had never had an account at all. The fix
// lives in the function, so "the function understands change_email" is what has
// to be true on the deployed copy - and it is also the one assertion that fails
// loudly if a redeploy is missed, which is exactly when this matters.
const changeEmail = await probe(
  'no Authorization header, asking to move a sign-in address',
  CRED,
  { action: 'change_email', userId: '00000000-0000-0000-0000-000000000000', email: 'not-an-address' },
);

// An undeployed function has its own signature. Distinguish it from a 401 so
// "not deployed yet" is never reported as "deployed and refusing".
const deployed = !/Edge Function .* not found/i.test(JSON.stringify(noAuth.json));
check('the function is deployed (not a 404 "not found")', deployed,
  noAuth.status === 404 && !deployed ? 'not deployed yet' : `status ${noAuth.status}`);

check('an unauthenticated create is refused with 401', noAuth.status === 401, `status ${noAuth.status}`);

// The refusal must come from the handler, and the handler's own code, because
// "the gateway stopped it" and "the handler checked it" are different claims and
// only the second one is true any more. See the note at the top of this file.
const GATEWAY_CODE = /^UNAUTHORIZED_/;
const fromHandler = String(noAuth.json?.code ?? '') === 'missing_token' && !GATEWAY_CODE.test(String(noAuth.json?.code ?? ''));
check('and it is the handler that refused, not the gateway', fromHandler,
  fromHandler
    ? `handler answered ${noAuth.json.code}`
    : GATEWAY_CODE.test(String(noAuth.json?.code ?? ''))
      ? `gateway answered ${noAuth.json.code} - verify_jwt is on, so supabase/config.toml and this file disagree`
      : `answered code=${noAuth.json?.code}`);

check('a forged token is refused identically', forged.status === noAuth.status,
  `no-auth ${noAuth.status} vs forged ${forged.status}`);

check('the same caller is answered for "forgot" rather than refused',
  forgot.status === 400 && forgot.json?.code === 'invalid_email',
  `status ${forgot.status} code=${forgot.json?.code} - if this is 401, verify_jwt was re-enabled and the reset link is dead for the people it exists for`);

// Two claims, asserted together. First, a refusal for `change_email` that is not
// "unknown action" means the deployed copy has the handler that understands it.
// Second, and just as important, that refusal is byte-for-byte the same shape as
// `create`'s - so adding an operation did not widen this endpoint into something
// whose action names a signed-out caller can enumerate.
check('the deployed copy understands "change_email"', !/Unknown action/i.test(JSON.stringify(changeEmail.json)),
  changeEmail.json?.code === 'upstream_failure' && /Unknown action/i.test(JSON.stringify(changeEmail.json))
    ? 'answered "Unknown action" - the function needs redeploying (supabase functions deploy staff-accounts)'
    : `answered code=${changeEmail.json?.code}`);

check('and it refuses exactly as "create" does, with nothing to enumerate',
  changeEmail.status === noAuth.status && changeEmail.json?.code === noAuth.json?.code,
  `create ${noAuth.status}/${noAuth.json?.code} vs change_email ${changeEmail.status}/${changeEmail.json?.code}`);

console.log(
  failures === 0
    ? '\nThe function is live. The handler refuses privileged actions to a caller who cannot sign in, and still answers the one action that must work without a session.'
    : `\n${failures} check(s) failed.`,
);
process.exitCode = failures === 0 ? 0 : 1;
