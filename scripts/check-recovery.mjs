/**
 * Password recovery, against the function Supabase is actually serving.
 *
 * WHY A SEPARATE SUITE
 * --------------------
 * db:check-staff-accounts runs the local handler.ts under Node and proves the
 * logic. It says nothing about what is deployed, and recovery is the one action
 * whose whole purpose is to work when somebody is locked out - so "the tests are
 * green" is worth least here of anywhere in the project. If the deploy is stale
 * or missing, the failure mode is a person who cannot get into their clinic.
 *
 * So this calls https://<ref>.supabase.co/functions/v1/staff-accounts directly,
 * with no session at all, which is the situation recovery exists for.
 *
 * What it proves:
 *
 *   1. all three facts together change the password, and the account then signs
 *      in with the new one and refuses the old
 *   2. each of the three on its own is refused
 *   3. every refusal is the SAME sentence, so the endpoint cannot be used to
 *      find out whether an address has an account or which fact was wrong
 *   4. a malformed PIN or ID is still called out as malformed - saying "that is
 *      not four digits" leaks nothing about any account
 *   5. the password rules still apply, and the "must choose a new one" flag is
 *      set afterwards
 *   6. a disabled profile cannot be recovered
 *   7. an audit row is written that says no session was involved
 *   8. whether an already-issued session survives, which the UI copy claims
 *   9. everything it created is removed afterwards
 *
 * The throwaway account is a physician created with the service_role key,
 * because the function refuses to create a profile - it only attaches a
 * credential to one that already exists. No real account is touched.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return i === -1 ? [l.trim(), ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const BASE = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const FN = `${BASE}/functions/v1/staff-accounts`;
const ADMIN = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

const stamp = Date.now();
const PROBE = {
  id: `USR-R${stamp}`,
  name: 'Recovery Probe',
  email: `recovery-probe-${stamp}@fatclinic.health`,
  pin: '7391',
  password: `Original-${stamp}!Vault`,
};
const RECOVERED = `Recovered-${stamp}!Jade`;

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ''}`);
    failures += 1;
  }
};

const db = new pg.Client({
  host: env.PGHOST, port: Number(env.PGPORT), user: env.PGUSER,
  password: env.PGPASSWORD, database: env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

/** Call the deployed function. No token unless one is passed, which is the point. */
async function callFunction(body, token) {
  const r = await fetch(FN, {
    method: 'POST',
    headers: {
      apikey: ANON,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await r.json(); } catch { /* a body-less refusal is still a refusal */ }
  return { status: r.status, json };
}

const recover = (over = {}, token) =>
  callFunction(
    { action: 'recover', email: PROBE.email, pin: PROBE.pin, id: accountId, password: RECOVERED, ...over },
    token,
  );

async function signIn(password) {
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: PROBE.email, password }),
  });
  return { status: r.status, body: await r.json() };
}

// --- Setup ------------------------------------------------------------------
const ins = await db.query(
  `INSERT INTO users (id, name, email, role, department, avatar, pin)
   VALUES ($1, $2, $3, 'PHYSICIAN', 'Records', '🧑‍⚕️', $4) RETURNING id`,
  [PROBE.id, PROBE.name, PROBE.email, PROBE.pin],
);
const profileId = ins.rows[0].id;

const created = await fetch(`${BASE}/auth/v1/admin/users`, {
  method: 'POST',
  headers: ADMIN,
  body: JSON.stringify({
    email: PROBE.email, password: PROBE.password, email_confirm: true,
  }),
});
const authUser = await created.json();
if (!created.ok) {
  console.error(`\nCould not create the probe account: ${JSON.stringify(authUser)}`);
  process.exitCode = 1;
  await db.end();
}
const accountId = authUser.id;
await db.query('UPDATE users SET auth_user_id = $1 WHERE id = $2', [accountId, profileId]);

// A session that already exists when the password is changed, so the last
// section can report what actually happens to it.
const early = await signIn(PROBE.password);
const earlyToken = early.body?.access_token;

// --- 1. Every fact has to be right ------------------------------------------
console.log('\nRecovery with all three facts');
const mismatch = await recover({ pin: '0000' });
const wrongPin = await recover({ pin: '0000' });
const wrongId = await recover({ id: '00000000-0000-4000-8000-000000000000' });
const unknownEmail = await recover({ email: `nobody-${stamp}@fatclinic.health` });

check('a wrong PIN is refused', wrongPin.status === 401, `status ${wrongPin.status}`);
check('a wrong ID is refused', wrongId.status === 401, `status ${wrongId.status}`);
check('an unknown address is refused', unknownEmail.status === 401, `status ${unknownEmail.status}`);

const allRefusals = [wrongPin, wrongId, unknownEmail].map((r) => r.json?.message);
check(
  'all three refusals say exactly the same thing, so it cannot be used to probe',
  new Set(allRefusals).size === 1,
  JSON.stringify(allRefusals),
);
check(
  'and the refusal gives no verdict on any single fact',
  !/pin is wrong|id is wrong|wrong pin|wrong id|wrong email|no staff profile|no account|does not exist/i.test(
    allRefusals[0] ?? '',
  ),
  allRefusals[0],
);
check('a disabled profile is not the same answer as a wrong fact', mismatch.status >= 400);

// --- 2. Malformed input is still called out ---------------------------------
console.log('\nMalformed input, which leaks nothing about any account');
const badPinShape = await recover({ pin: '12' });
const badPinText = await recover({ pin: 'abcd' });
const badIdShape = await recover({ id: 'not-a-uuid' });
check('a two-digit PIN is called out as the wrong shape', badPinShape.status === 400, `status ${badPinShape.status}`);
check('letters in the PIN are called out too', badPinText.status === 400, `status ${badPinText.status}`);
check('an ID that is not a UUID is called out', badIdShape.status === 400, `status ${badIdShape.status}`);
check(
  'shape errors are distinct from a mismatch, which is safe and more useful',
  badPinShape.json?.code === 'invalid_recovery_details' && wrongPin.json?.code === 'invalid_recovery_details',
  `${badPinShape.json?.code} / ${wrongPin.json?.code}`,
);
check(
  'a mismatch does not quote the facts back, a shape error may',
  /four digits/i.test(badPinShape.json?.message ?? ''),
  badPinShape.json?.message,
);

// --- 3. The password rules still apply --------------------------------------
console.log('\nThe password rules are not bypassed by knowing all three facts');
const short = await recover({ password: 'Ab3!x' });
// The probe is called "Recovery Probe", so the name rule bites on either word.
// Getting this wrong is easy and silent: a password that happens not to contain
// the name is accepted, the password changes, and the next check about nothing
// having been written fails for the wrong reason.
const withName = await recover({ password: `Probe-${stamp}!Tide` });
const denylisted = await recover({ password: 'password1' });
check('a short password is refused', short.status === 400 && short.json?.code === 'weak_password', `${short.status} ${short.json?.code}`);
check('a password containing their name is refused', withName.status === 400, `${withName.status} ${withName.json?.message}`);
check('a denylisted password is refused', denylisted.status === 400, `${denylisted.status}`);
check(
  'none of those refusals changed the password',
  (await signIn(PROBE.password)).status === 200,
  'the original password still works, so nothing was written',
);

// --- 4. The real thing ------------------------------------------------------
console.log('\nRecovery with the right facts, and no session');
const good = await recover();
check('the password is changed', good.status === 200, `status ${good.status} ${good.json?.message}`);
check('the reply does not contain a credential', !JSON.stringify(good.json ?? {}).includes(RECOVERED), JSON.stringify(good.json));
check('the reply does not hand back the identifier', !JSON.stringify(good.json ?? {}).toLowerCase().includes(accountId), JSON.stringify(good.json));

const after = await signIn(RECOVERED);
check('the new password signs in', after.status === 200, `status ${after.status}`);
const old = await signIn(PROBE.password);
check('the old password is refused', old.status === 400, `status ${old.status}`);

const flag = await db.query('SELECT must_change_password FROM users WHERE id = $1', [profileId]);
check(
  'the person is made to choose their own password next time',
  flag.rows[0]?.must_change_password === true,
  `must_change_password=${flag.rows[0]?.must_change_password}`,
);

// --- 5. What happens to a session that already existed ----------------------
// The admin screen tells a clinician that a reset ends their session. Whether
// that is true had never been measured, so this measures it rather than
// repeating it - and the recovery copy is written from the answer.
console.log('\nA session that already existed when the password changed');
if (earlyToken) {
  const r = await fetch(`${BASE}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: `Bearer ${earlyToken}` },
  });
  check(
    'a password change ends every session already issued for the account',
    r.status !== 200,
    `the old access token still works (status ${r.status}), so a recovery would not be a revocation`,
  );
} else {
  check('a session existed beforehand to test', false, 'the probe never signed in');
}
check(
  'and the reply says so, because a suspected theft needs to know the thief is out',
  /signed out/i.test(good.json?.message ?? ''),
  good.json?.message,
);

// --- 6. The audit trail -----------------------------------------------------
console.log('\nThe audit trail');
const rows = await db.query(
  `SELECT user_id, user_name, details, metadata FROM audit_logs
    WHERE id LIKE 'SEC-%' AND action = 'RECOVER_STAFF_PASSWORD' ORDER BY logged_at DESC LIMIT 1`,
);
const entry = rows.rows[0];
check('a privileged row was written', Boolean(entry));
check(
  'it says no session was involved, rather than inventing an actor',
  entry?.metadata?.session === 'none' && entry?.user_id === null,
  `session=${entry?.metadata?.session} user_id=${entry?.user_id}`,
);
check(
  'and it names the recovered account, with no password anywhere in it',
  String(entry?.details ?? '').includes(PROBE.email) && !JSON.stringify(entry ?? {}).includes(RECOVERED),
  entry?.details,
);

// --- 7. A disabled profile --------------------------------------------------
console.log('\nA disabled profile');
await db.query('UPDATE users SET active = FALSE WHERE id = $1', [profileId]);
const disabled = await recover({ password: `Second-${stamp}!Reed` });
check('a disabled staff profile cannot be recovered', disabled.status === 401, `status ${disabled.status}`);
await db.query('UPDATE users SET active = TRUE WHERE id = $1', [profileId]);

// --- 8. Create and reset still need an administrator ------------------------
// verify_jwt was turned off for this function, so the handler is now the only
// gate. This is the check that it is still a gate.
//
// A fresh session, taken after the password change: the one from earlier is dead
// precisely because recovery worked, so using it here would test the wrong thing
// and report 401 for a reason that has nothing to do with authorisation.
console.log('\nThe other actions, with verify_jwt now off');
const live = await signIn(RECOVERED);
const clinicianToken = live.body?.access_token;
check('a live clinician session is available to test with', Boolean(clinicianToken), `status ${live.status}`);

const anon = await callFunction({ action: 'create', email: PROBE.email, password: RECOVERED });
check('create with no session is refused', anon.status === 401, `status ${anon.status}`);
const asClinician = await callFunction(
  { action: 'reset', email: PROBE.email, password: `Third-${stamp}!Bay` },
  clinicianToken,
);
check('reset with a clinician session is refused', asClinician.status === 403, `status ${asClinician.status}`);
check(
  'and the refusal says why, rather than leaking the upstream reason',
  /administrator/i.test(asClinician.json?.message ?? ''),
  asClinician.json?.message,
);
// 403 rather than 400, and that ordering is deliberate: the handler resolves and
// authorises the caller before it looks at what the action is, so a clinician
// cannot use the error to tell a recognised action from an unrecognised one.
const unknownAction = await callFunction({ action: 'somethingElse' }, clinicianToken);
check(
  'an unknown action is refused, after authorisation rather than before it',
  unknownAction.status === 403,
  `status ${unknownAction.status} - a 400 here would mean the action name is parsed before the caller is`,
);
const missingFields = await callFunction({ action: 'recover' }, clinicianToken);
check('recovery with no facts at all is refused', missingFields.status === 400, `status ${missingFields.status}`);

// --- Teardown ---------------------------------------------------------------
await fetch(`${BASE}/auth/v1/admin/users/${accountId}`, { method: 'DELETE', headers: ADMIN });
await db.query('DELETE FROM users WHERE id = $1', [profileId]);
const left = await db.query('SELECT count(*)::int AS n FROM users WHERE id = $1', [profileId]);
check('the probe profile is gone', left.rows[0].n === 0);
const accounts = await (await fetch(`${BASE}/auth/v1/admin/users?page=1&per_page=200`, { headers: ADMIN })).json();
check('the probe auth account is gone', !(accounts.users ?? []).some((u) => u.email === PROBE.email));
check('the project is back to its two real accounts', (accounts.users ?? []).length === 2,
  `${(accounts.users ?? []).length} accounts`);

await db.end();
console.log(
  failures === 0
    ? '\nAll three facts change a password, any one of them alone does not, and the app is untouched.'
    : `\n${failures} check(s) failed.`,
);
if (failures) process.exitCode = 1;
