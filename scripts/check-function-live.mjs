/**
 * Is the staff-accounts Edge Function actually live, and is the gateway
 * verifying JWTs before the handler runs?
 *
 * A deployed function answers. An undeployed one answers 404 with
 * {"message":"Edge Function \"staff-accounts\" not found"}. Neither needs
 * the service_role key, so this is safe to run any time.
 *
 * Two probes, because "it exists" and "it is locked down" are different
 * claims and only the second one is the one that matters:
 *
 *   1. no Authorization header  -> 401 from the GATEWAY. The function was
 *      never asked whether this caller is an administrator, because the
 *      gateway stopped the request first. That is verify_jwt doing its job.
 *   2. a token that is not a JWT -> also 401, from the same place, and it
 *      must not be a different answer from probe 1.
 *
 * If probe 1 returns 401 from the handler instead (a JSON body with a "code"
 * we recognise), the function is live but the gateway is NOT verifying, and
 * the handler is the only thing standing between the public internet and the
 * service_role key. That is the failure worth catching here.
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

async function probe(label, headers) {
  const r = await fetch(FN, { method: 'POST', headers, body: JSON.stringify({ action: 'create' }) });
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

console.log(`Probing ${FN}\n`);

const noAuth = await probe('no Authorization header at all', {
  apikey: ANON,
  'Content-Type': 'application/json',
});

const notAJwt = await probe('a syntactically valid but unsigned token', {
  apikey: ANON,
  'Content-Type': 'application/json',
  Authorization: 'Bearer not.a.real.jwt',
});

// An undeployed function has its own signature. Distinguish it from a 401 so
// "not deployed yet" is never reported as "deployed and locked down".
const deployed = !/Edge Function .* not found/i.test(JSON.stringify(noAuth.json));
check('the function is deployed (not a 404 "not found")', deployed,
  noAuth.status === 404 && !deployed ? 'not deployed yet' : `status ${noAuth.status}`);

check('an unauthenticated POST is refused with 401', noAuth.status === 401, `status ${noAuth.status}`);

// Both the gateway and the handler answer with a "code", and they must not be
// confused. The gateway's codes are always UNAUTHORIZED_* ("no auth header",
// "invalid JWT format"); the handler's are lowercase snake_case, e.g.
// missing_token or upstream_failure. Keying on "a code exists" instead would
// flag the gateway as the handler, which is exactly the distinction this check
// exists to make.
const GATEWAY_CODE = /^UNAUTHORIZED_/;
const gatewayStoppedIt = GATEWAY_CODE.test(String(noAuth.json?.code ?? ''));
check('the request was stopped by the gateway, not the handler', gatewayStoppedIt,
  gatewayStoppedIt
    ? `gateway refused with ${noAuth.json.code}`
    : `reached the handler, which answered with code=${noAuth.json?.code}`);

check('a forged token is refused identically', notAJwt.status === noAuth.status,
  `no-auth ${noAuth.status} vs forged ${notAJwt.status}`);

console.log(
  failures === 0
    ? '\nThe function is live and the gateway is refusing callers before the handler runs.'
    : `\n${failures} check(s) failed.`,
);
process.exitCode = failures === 0 ? 0 : 1;
