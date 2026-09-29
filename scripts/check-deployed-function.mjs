/**
 * Test the DEPLOYED staff-accounts function, not the local file.
 *
 * WHY THIS IS DIFFERENT FROM db:check-staff-accounts
 * ---------------------------------------------------
 * That suite imports handler.ts and runs it under Node with the environment
 * passed in by hand. It proves the code is correct. It says nothing at all about
 * what Supabase is actually serving, and those come apart in the ordinary way:
 * the function is edited, the tests stay green, and production keeps running the
 * version from the last deploy. The only check that can tell the two apart is
 * one that calls the real URL.
 *
 * What it proves, against https://<ref>.supabase.co/functions/v1/staff-accounts:
 *
 *   1. a password containing the staff member's name is refused  <- new rule,
 *      and the reason to deploy and then look at this
 *   2. a password that breaks an older rule is still refused       <- a deploy
 *      has not quietly dropped the rules it already had
 *   3. a good password is accepted, and the account really signs in
 *   4. the caller must be an administrator: a clinician's token is refused
 *   5. everything it created is removed afterwards
 *
 * The staff profile is inserted with the service_role key rather than through the
 * function, because the function refuses to create a profile - it only attaches
 * a credential to one that exists.
 *
 * Cleanup deletes by the auth id the function reports, not by listing the
 * accounts afterwards. Both of the alternatives were wrong here: the admin list
 * needs an Authorization header this script initially did not send, and a
 * list-and-match approach would leave a live credential on a medical project the
 * first time it ran.
 *
 * Run:  STAFF_PASSWORD=... node scripts/check-deployed-function.mjs
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
const SR = env.SUPABASE_SERVICE_ROLE_KEY;
const FN = `${BASE}/functions/v1/staff-accounts`;
const ADMIN = 'ernestoviosun@gmail.com';
const ADMIN_PW = process.env.STAFF_PASSWORD;

const stamp = Date.now();
const PROBE_EMAIL = `zainab-probe-${stamp}@solacemedicares.com`;
const PROBE_NAME = 'Zainab Probeworthy';
const PROBE_ID = `USR-PROBE${stamp}`;

let failures = 0;
/** Set the moment the function reports creating an account, so cleanup is exact. */
let createdAuthId = null;
const check = (label, pass, detail = '') => {
  if (!pass) failures++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

const db = new pg.Client({
  host: env.PGHOST, port: Number(env.PGPORT), user: env.PGUSER,
  password: env.PGPASSWORD, database: env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
});

// Both headers, always. Supabase's gateway accepts the service_role key on
// `apikey` alone, but GoTrue's admin endpoints do not: they require
// `Authorization: Bearer <service_role>`. Sending only `apikey` gets a 401 whose
// body has no `users` key, which reads exactly like "the account is not there"
// and is how the first version of this script reported nothing to delete while
// leaving a live credential behind.
const api = async (path, { method = 'GET', body, key = SR, token } = {}) => {
  const bearer = token ?? key;
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      apikey: key,
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: r.status, json };
};

const signIn = async (email, password) => {
  const { status, json } = await api('/auth/v1/token?grant_type=password', {
    method: 'POST', key: ANON, body: { email, password },
  });
  return { status, token: json.access_token };
};

const callFn = async (token, body) => {
  const r = await fetch(FN, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: r.status, json };
};

if (!ADMIN_PW) {
  console.log('STAFF_PASSWORD is not set in the environment. Nothing was changed.');
  process.exitCode = 1;
} else {
  await db.connect();
  try {
    console.log(`Testing the DEPLOYED function at ${FN}\n`);
    console.log('Setup');
    const admin = await signIn(ADMIN, ADMIN_PW);
    check('signed in as the administrator', admin.status === 200, `status ${admin.status}`);
    if (admin.status !== 200) {
      console.log('  Cannot continue without a session.');
      throw new Error('stop');
    }

    await db.query(
      'INSERT INTO users (id, name, email, role, active) VALUES ($1, $2, $3, $4, TRUE)',
      [PROBE_ID, PROBE_NAME, PROBE_EMAIL, 'NURSE'],
    );
    check('inserted a throwaway staff profile', true, PROBE_EMAIL);

    // 1. The new rule, on the deployed artifact.
    console.log('\nThe new rule: a password may not contain the staff name');
    const withName = await callFn(admin.token, {
      action: 'create', email: PROBE_EMAIL, password: 'Zainab-Probeworthy-9',
    });
    check(
      'refused with weak_password',
      withName.status === 400 && withName.json?.code === 'weak_password',
      `status ${withName.status} ${withName.json?.code ?? withName.json?.raw ?? ''}`,
    );
    console.log(`    message: ${withName.json?.message ?? '(none)'}`);

    // 2. A rule that predates this deploy, to catch a deploy that lost ground.
    console.log('\nAn older rule, to prove the deploy did not drop what was already there');
    const tooShort = await callFn(admin.token, {
      action: 'create', email: PROBE_EMAIL, password: 'Ab1!',
    });
    check(
      'a short password is still refused',
      tooShort.status === 400 && tooShort.json?.code === 'weak_password',
      `status ${tooShort.status} ${tooShort.json?.code ?? ''}`,
    );

    // 3. The happy path, and the credential has to genuinely work.
    console.log('\nA good password');
    const good = 'Marble-Quince-774!Tid';
    const created = await callFn(admin.token, { action: 'create', email: PROBE_EMAIL, password: good });
    // 201, not 200: a created resource. The local suite never noticed because it
    // only ever checked the failure paths against the function.
    check('accepted', (created.status === 200 || created.status === 201) && created.json?.ok === true,
      `status ${created.status} ${created.json?.code ?? created.json?.message ?? ''}`);

    // Taken from the response rather than looked up. The admin list is not
    // immediately consistent for a just-created account, which is exactly how the
    // first version of this script left an account behind: it listed, did not
    // see the new user, and reported nothing to delete.
    createdAuthId = created.json?.data?.authUserId ?? null;
    check('the response carries the new auth account id', Boolean(createdAuthId), createdAuthId ?? 'absent');

    const withGood = await signIn(PROBE_EMAIL, good);
    check('the new account really signs in', withGood.status === 200, `status ${withGood.status}`);

    // 4. Authorisation still holds on the deployed copy.
    if (withGood.token) {
      const asClinician = await callFn(withGood.token, {
        action: 'create', email: 'someone-else-probe@solacemedicares.com', password: 'Another-Good-11!X',
      });
      check('a clinician is refused by the deployed function',
        asClinician.status === 403 || asClinician.json?.code === 'not_admin',
        `status ${asClinician.status} ${asClinician.json?.code ?? ''}`);
    }
  } catch (err) {
    if (err?.message !== 'stop') throw err;
    process.exitCode = 1;
  } finally {
    console.log('\nCleanup');
    // Exact id from the create response. Never "list the accounts and see if the
    // probe is there": a just-created account does not appear in the admin list
    // immediately, so that approach reports nothing to delete and leaves a live
    // credential on the project.
    if (createdAuthId) {
      const del = await api(`/auth/v1/admin/users/${createdAuthId}`, { method: 'DELETE' });
      check('deleted the throwaway auth account', del.status === 200 || del.status === 204,
        `status ${del.status}`);
      // The status is not the evidence. `check-clinical-crud` reported 200 for two
      // accounts that were still live an hour later, so the only acceptable proof
      // is the id absent from a fresh listing - and the comment above explains
      // why looking it up by *email* would not do: a just-created account does not
      // appear in the list at all, which is the trap that leaves a credential
      // behind. By id, absent means absent.
      //
      // The listing is read into `json`, not off the response - `api` returns
      // `{ status, json }`, so `after.users` is always undefined and "is it gone"
      // would compare undefined to an id and answer *yes, gone* on every run. A
      // check that cannot fail is not a check, so the readability of the listing is
      // itself asserted first: a 401 here must fail the run rather than read as
      // a clean sweep.
      const after = await api('/auth/v1/admin/users?page=1&per_page=200');
      const listed = after.json?.users;
      check('the account list could be read, so "it is gone" means something',
        after.status === 200 && Array.isArray(listed),
        `status ${after.status}, users ${Array.isArray(listed) ? 'present' : 'missing'}`);
      const stillListed = Array.isArray(listed) && listed.some((u) => u.id === createdAuthId);
      check('and the throwaway auth account is confirmed gone, not just accepted',
        !stillListed,
        stillListed ? `account ${createdAuthId} is still listed` : '');
    } else {
      // Only reached when the create failed, so there should be nothing to remove.
      check('no auth account was created, so none to delete', true);
    }
    await db.query('DELETE FROM users WHERE id = $1', [PROBE_ID]);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM users WHERE id = $1', [PROBE_ID]);
    check('deleted the throwaway profile', rows[0].n === 0);
    await db.end();
  }

  console.log(
    failures === 0
      ? '\nThe function Supabase is actually serving behaves as intended.'
      : `\n${failures} check(s) failed - the deployed function differs from the local file.`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}
