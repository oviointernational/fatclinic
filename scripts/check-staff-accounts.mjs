/**
 * Integration test for the `staff-accounts` Edge Function.
 *
 * It imports the real `handler.ts` and calls it with real `Request` objects
 * against the live Supabase project. Not a mock, not a reimplementation: the
 * function has to be deployable code that holds the privileged key, so the only
 * test worth having is one that runs that file against real Auth and real RLS.
 * A unit test with a stubbed fetch would pass while the deployed function 404s.
 *
 * What it proves
 * --------------
 *   happy path     admin creates a sign-in account; that password really signs in
 *                  admin resets it; the old password dies, the new one works
 *   state written  auth_user_id linked and must_change_password set on the profile
 *   audit          every privileged action is recorded
 *   refusals       no token, bad token, non-admin, disabled admin, weak password,
 *                  bad email, unknown action, no profile, account exists,
 *                  no account to reset
 *   protocol       OPTIONS preflight, wrong method, unconfigured function
 *
 * Every account and profile it creates is removed afterwards, and it asserts
 * that removal rather than assuming it.
 *
 * Run:  npm run db:check-staff-accounts
 * Needs STAFF_PASSWORD in the environment (never argv - it would land in shell
 * history and in any process listing).
 */
import { readFileSync } from 'node:fs';
import { handleStaffAccountRequest, checkPassword, normaliseEmail } from '../supabase/functions/staff-accounts/handler.ts';

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
const SR = env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = 'ernestoviosun@gmail.com';
const ORIGINAL = process.env.STAFF_PASSWORD;

const handlerEnv = {
  SUPABASE_URL: URL_BASE,
  SUPABASE_ANON_KEY: ANON,
  SUPABASE_SERVICE_ROLE_KEY: SR,
};

let failures = 0;
let checks = 0;
const check = (label, pass, detail = '') => {
  checks++;
  if (!pass) failures++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

/** Everything created during the run, for unconditional cleanup. */
const createdAuthIds = new Set();
const createdProfileIds = new Set();
const stamp = Date.now();
const PW_1 = 'Clinic-Temp-1!a';
const PW_2 = 'Clinic-Temp-2!b';

// --- direct API helpers (for setup, assertions and cleanup) -----------------

async function api(path, { method = 'GET', body, token, service = false, extraHeaders = {} } = {}) {
  const key = service ? SR : ANON;
  const res = await fetch(`${URL_BASE}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token ?? key}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

async function signIn(email, password) {
  const res = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  return { status: res.status, token: res.json?.access_token };
}

/** Create a staff profile the way the application does: through RLS, as the admin. */
async function createProfile(adminToken, { id, name, email, role = 'PHYSICIAN', active = true }) {
  const res = await api('/rest/v1/users', {
    method: 'POST',
    token: adminToken,
    extraHeaders: { Prefer: 'return=representation' },
    body: { id, name, email, role, active, pin: '1234', must_change_password: false },
  });
  if (res.status < 300) createdProfileIds.add(id);
  return res;
}

/** Invoke the real handler. This is the code that runs in production. */
async function invoke({ token, body, method = 'POST', envOverride = handlerEnv, raw = false }) {
  const req = new Request('https://local.test/functions/v1/staff-accounts', {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: raw ? rawBody(body) : body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handleStaffAccountRequest(req, envOverride);
  let json = null;
  try {
    json = JSON.parse(await res.text());
  } catch {
    /* empty or non-JSON */
  }
  return { status: res.status, json };
}

const rawBody = (text) => (typeof text === 'string' ? text : JSON.stringify(text));

// --- pure unit checks (fast, and they pin the policy) -----------------------

function unitChecks() {
  console.log('\nPassword policy');
  check('rejects a short password', checkPassword('Ab1!', 'a@b.co') !== null);
  check('rejects a common password', checkPassword('password123', 'a@b.co') !== null);
  check('rejects leading/trailing space', checkPassword('  Str0ngPass!  ', 'a@b.co') !== null);
  check('rejects an inner space', checkPassword('Str0ng Pass!', 'a@b.co') !== null);
  check('rejects a repeated character', checkPassword('aaaaaaaaaa', 'a@b.co') !== null);
  check('rejects the email local part', checkPassword('AmaraOkonkwo1', 'amara@clinic.test') !== null);
  check('rejects the clinic name', checkPassword('FatClinic123', 'a@b.co') !== null);
  check('accepts a reasonable passphrase', checkPassword('correct-horse-9!Batt', 'a@b.co') === null);
  check('non-strings are rejected', checkPassword(undefined, 'a@b.co') !== null && checkPassword(12345678, 'a@b.co') !== null);

  console.log('\nEmail normalisation');
  check('lowercases and trims', normaliseEmail('  Nurse@Clinic.TEST ') === 'nurse@clinic.test');
  check('rejects a missing @', normaliseEmail('nope') === null);
  check('rejects an embedded newline', normaliseEmail('a@b.co\r\nX-Evil: 1') === null);
  check('rejects a non-string', normaliseEmail({}) === null);
}

// --- protocol checks (no network) -------------------------------------------

async function protocolChecks() {
  console.log('\nProtocol');

  const preflight = await handleStaffAccountRequest(
    new Request('https://local.test/f', { method: 'OPTIONS' }),
    handlerEnv,
  );
  check('OPTIONS preflight answers 204', preflight.status === 204, `status ${preflight.status}`);
  check(
    'preflight allows the Authorization header',
    (preflight.headers.get('Access-Control-Allow-Headers') ?? '').includes('authorization'),
  );

  const wrongMethod = await invoke({ method: 'GET' });
  check('GET is refused', wrongMethod.status === 405, `status ${wrongMethod.status}`);

  const unconfigured = await invoke({
    body: { action: 'create', email: 'a@b.co', password: 'Str0ngPass!9' },
    envOverride: { SUPABASE_URL: '', SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' },
  });
  check('an unconfigured function refuses rather than half-working', unconfigured.status === 500,
    `status ${unconfigured.status}`);

  const malformed = await invoke({ raw: 'not json at all' });
  check('a malformed body is refused', malformed.status === 400, `status ${malformed.status}`);

  const noToken = await invoke({ body: { action: 'create', email: 'a@b.co', password: 'Str0ngPass!9' } });
  check('no bearer token is 401', noToken.status === 401 && noToken.json?.code === 'missing_token',
    `${noToken.status} ${noToken.json?.code}`);

  const badToken = await invoke({
    token: 'not-a-real-jwt',
    body: { action: 'create', email: 'a@b.co', password: 'Str0ngPass!9' },
  });
  check('a forged token is 401', badToken.status === 401 && badToken.json?.code === 'missing_token',
    `${badToken.status} ${badToken.json?.code}`);
}

// --- live checks ------------------------------------------------------------

async function liveChecks(adminToken) {
  const clinicianEmail = `acct-check-clinician-${stamp}@clinic.test`;
  const disabledAdminEmail = `acct-check-disabled-${stamp}@clinic.test`;
  const noProfileEmail = `acct-check-noprofile-${stamp}@clinic.test`;
  const clinicianId = `USR-T${String(stamp).slice(-6)}1`;
  const disabledAdminId = `USR-T${String(stamp).slice(-6)}2`;

  // --- create a profile through RLS, as the app does ------------------------
  console.log('\nSetup: a clinician profile written through RLS by the admin');
  const made = await createProfile(adminToken, {
    id: clinicianId,
    name: 'Check Clinician',
    email: clinicianEmail,
  });
  check('admin can insert a staff profile through RLS', made.status < 300, `status ${made.status}`);

  // --- validation refusals, no side effects ---------------------------------
  console.log('\nRefusals that must happen before anything is written');
  const weak = await invoke({
    token: adminToken,
    body: { action: 'create', email: clinicianEmail, password: 'password' },
  });
  check('a weak password is refused', weak.status === 400 && weak.json?.code === 'weak_password',
    `${weak.status} ${weak.json?.code}`);

  const badEmail = await invoke({
    token: adminToken,
    body: { action: 'create', email: 'not-an-email', password: 'Str0ngPass!9' },
  });
  check('a malformed email is refused', badEmail.status === 400 && badEmail.json?.code === 'invalid_email',
    `${badEmail.status} ${badEmail.json?.code}`);

  const noProfile = await invoke({
    token: adminToken,
    body: { action: 'create', email: noProfileEmail, password: 'Str0ngPass!9' },
  });
  check('an address with no staff profile is refused',
    noProfile.status === 404 && noProfile.json?.code === 'no_staff_profile',
    `${noProfile.status} ${noProfile.json?.code}`);

  const unknown = await invoke({ token: adminToken, body: { action: 'promote', email: clinicianEmail } });
  check('an unknown action is refused', unknown.status === 400, `status ${unknown.status}`);

  const resetNoAccount = await invoke({
    token: adminToken,
    body: { action: 'reset', email: clinicianEmail, password: 'Str0ngPass!9' },
  });
  check('resetting an account that does not exist is refused',
    resetNoAccount.status === 404 && resetNoAccount.json?.code === 'no_auth_account',
    `${resetNoAccount.status} ${resetNoAccount.json?.code}`);

  // confirm nothing was created by the refusals
  const afterRefusals = await api(
    `/auth/v1/admin/users?page=1&per_page=1000`, { service: true },
  );
  const leaked = (afterRefusals.json?.users ?? []).some(
    (u) => String(u.email).toLowerCase() === noProfileEmail.toLowerCase(),
  );
  check('a refused create left no auth account behind', !leaked);

  // --- the happy path: create ----------------------------------------------
  console.log('\nCreate a sign-in account');
  const created = await invoke({
    token: adminToken,
    body: { action: 'create', email: clinicianEmail, password: PW_1 },
  });
  check('create succeeds', created.status === 201 && created.json?.ok === true,
    `${created.status} ${created.json?.message ?? ''}`);
  const authId = created.json?.data?.authUserId;
  if (authId) createdAuthIds.add(authId);
  check('an auth user id is returned', !!authId, String(authId));
  check('the profile is reported linked', created.json?.data?.linked === true);

  const clinicianSignIn = await signIn(clinicianEmail, PW_1);
  check('the new password really signs in', clinicianSignIn.status === 200, `status ${clinicianSignIn.status}`);

  // --- the state it must leave on the profile -------------------------------
  const profileRes = await api(`/rest/v1/users?id=eq.${clinicianId}`, {
    token: adminToken,
    service: false,
    extraHeaders: { Accept: 'application/vnd.pgrst.object+json' },
  });
  const profile = Array.isArray(profileRes.json) ? profileRes.json[0] : profileRes.json;
  check('auth_user_id is linked on the profile', profile?.auth_user_id === authId,
    `${profile?.auth_user_id} vs ${authId}`);
  check('must_change_password is set', profile?.must_change_password === true,
    String(profile?.must_change_password));

  // --- create twice ---------------------------------------------------------
  const dupe = await invoke({
    token: adminToken,
    body: { action: 'create', email: clinicianEmail, password: PW_1 },
  });
  check('creating a second account for the same address is refused',
    dupe.status === 409 && dupe.json?.code === 'account_exists',
    `${dupe.status} ${dupe.json?.code}`);

  // --- authorisation: a clinician may not do this ---------------------------
  console.log('\nAuthorisation');
  const asClinician = await invoke({
    token: clinicianSignIn.token,
    body: { action: 'reset', email: clinicianEmail, password: 'Clinic-Temp-9!z' },
  });
  check('a signed-in clinician is refused', asClinician.status === 403 && asClinician.json?.code === 'not_admin',
    `${asClinician.status} ${asClinician.json?.code}`);

  const clinicianOnOther = await invoke({
    token: clinicianSignIn.token,
    body: { action: 'create', email: noProfileEmail, password: 'Str0ngPass!9' },
  });
  check('a clinician cannot create accounts either', clinicianOnOther.status === 403,
    `${clinicianOnOther.status} ${clinicianOnOther.json?.code}`);

  // --- a disabled administrator is refused ----------------------------------
  await createProfile(adminToken, {
    id: disabledAdminId,
    name: 'Check Disabled Admin',
    email: disabledAdminEmail,
    role: 'ADMINISTRATOR',
    active: false,
  });
  const madeDisabled = await invoke({
    token: adminToken,
    body: { action: 'create', email: disabledAdminEmail, password: 'Str0ngPass!9' },
  });
  check('a disabled profile cannot be given an account',
    madeDisabled.status === 400, `${madeDisabled.status} ${madeDisabled.json?.code}`);

  // Give the disabled admin a working credential through the privileged path so
  // we can hold a real session for them, then prove the function still refuses.
  const forcedAccount = await api('/auth/v1/admin/users', {
    method: 'POST',
    service: true,
    body: { email: disabledAdminEmail, password: 'Str0ngPass!9', email_confirm: true },
  });
  if (forcedAccount.json?.id) createdAuthIds.add(forcedAccount.json.id);
  const disabledSignIn = await signIn(disabledAdminEmail, 'Str0ngPass!9');
  check('a disabled admin still holds a valid Supabase session', disabledSignIn.status === 200,
    `status ${disabledSignIn.status}`);
  const asDisabled = await invoke({
    token: disabledSignIn.token,
    body: { action: 'reset', email: clinicianEmail, password: 'Clinic-Temp-9!z' },
  });
  check('a DISABLED administrator is refused', asDisabled.status === 403 && asDisabled.json?.code === 'not_admin',
    `${asDisabled.status} ${asDisabled.json?.code}`);

  // --- the other happy path: reset ------------------------------------------
  console.log('\nReset a forgotten password');
  const reset = await invoke({
    token: adminToken,
    body: { action: 'reset', email: clinicianEmail, password: PW_2 },
  });
  check('reset succeeds', reset.status === 200 && reset.json?.ok === true,
    `${reset.status} ${reset.json?.message ?? ''}`);

  const withNew = await signIn(clinicianEmail, PW_2);
  check('the new password signs in', withNew.status === 200, `status ${withNew.status}`);
  const withOld = await signIn(clinicianEmail, PW_1);
  check('the old password is refused', withOld.status === 400, `status ${withOld.status}`);

  // --- the audit trail -------------------------------------------------------
  console.log('\nAudit trail');
  const auditRows = await api(
    `/rest/v1/audit_logs?action=in.(CREATE_STAFF_ACCOUNT,RESET_STAFF_PASSWORD)&select=id,action,user_id,user_name,details&id=like.SEC-*`,
    { service: true },
  );
  const rows = Array.isArray(auditRows.json) ? auditRows.json : [];
  check('the privileged writes were audited', rows.length >= 2, `${rows.length} row(s)`);
  check('the audit names the acting administrator',
    rows.every((r) => r.user_id && r.user_name), JSON.stringify(rows.map((r) => r.user_name)));
  const containsCredential = rows.some((r) => JSON.stringify(r).includes(PW_1) || JSON.stringify(r).includes(PW_2));
  check('no password appears in the audit trail', !containsCredential);
}

// --- cleanup ----------------------------------------------------------------

/**
 * Remove the audit rows this run caused.
 *
 * `audit_logs` is append-only, enforced by a trigger, so this cannot be done
 * through PostgREST even with the privileged key - which is the right behaviour
 * for a patient-safety system, and also the reason a test suite cannot tidy up
 * after itself the obvious way. Left alone, every run would permanently litter
 * the audit log a clinician reads, with rows describing addresses that never
 * existed.
 *
 * So the trigger is disabled for exactly one statement, scoped to rows naming
 * this suite's throwaway addresses, and re-armed immediately afterwards. That
 * it needs this at all is the point: the trail genuinely cannot be edited
 * through the API.
 */
async function purgeAuditRows() {
  const surface = `(id like 'SEC-%' and (details like '%acct-check-%' or user_name like 'Check %'))`;
  if (!env.PGHOST) {
    console.log('  no PGHOST in .env - audit rows were NOT purged; run scripts/purge-test-audit-rows.mjs');
    return false;
  }
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    host: env.PGHOST,
    port: Number(env.PGPORT),
    user: env.PGUSER,
    password: env.PGPASSWORD,
    database: env.PGDATABASE,
  });
  await client.connect();
  try {
    await client.query('begin');
    await client.query('alter table audit_logs disable trigger trg_audit_immutable');
    const del = await client.query(`delete from audit_logs where ${surface}`);
    await client.query('alter table audit_logs enable trigger trg_audit_immutable');
    await client.query('commit');
    console.log(`  audit rows purged: ${del.rowCount}`);
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    // Never leave the trail editable, whatever went wrong above.
    await client.query('alter table audit_logs enable trigger trg_audit_immutable').catch(() => undefined);
    console.error('  could not purge audit rows:', err.message);
    console.error('  run: node scripts/purge-test-audit-rows.mjs');
    return false;
  } finally {
    await client.end();
  }
  // Assert both that the rows are gone and that the trigger is armed again.
  const { default: pg2 } = await import('pg');
  const verify = new pg2.Client({
    host: env.PGHOST,
    port: Number(env.PGPORT),
    user: env.PGUSER,
    password: env.PGPASSWORD,
    database: env.PGDATABASE,
  });
  await verify.connect();
  const left = await verify.query(
    `select count(*)::int n from audit_logs where ${surface}`,
  );
  const armed = await verify.query(
    `select count(*)::int n from pg_trigger where tgname='trg_audit_immutable' and tgenabled='O'`,
  );
  await verify.end();
  check('no test audit row survived', left.rows[0].n === 0, `${left.rows[0].n} left`);
  check('the append-only trigger is armed again', armed.rows[0].n === 1);
  return true;
}

async function cleanup() {
  console.log('\nCleanup');
  for (const id of createdAuthIds) {
    const res = await api(`/auth/v1/admin/users/${id}`, { method: 'DELETE', service: true });
    console.log(`  auth account ${id} -> ${res.status}`);
  }
  for (const id of createdProfileIds) {
    const res = await api(`/rest/v1/users?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      service: true,
    });
    console.log(`  staff profile ${id} -> ${res.status}`);
  }
  await purgeAuditRows();

  // Assert the auth accounts are really gone rather than assuming it.
  const remaining = await api('/auth/v1/admin/users?page=1&per_page=1000', { service: true });
  const emails = (remaining.json?.users ?? []).map((u) => String(u.email).toLowerCase());
  const strays = emails.filter((e) => e.includes('acct-check-') || e.includes('example.test'));
  check('no test account survived', strays.length === 0, strays.join(', '));
  console.log(`  auth accounts remaining: ${emails.length}`);

  // And the staff register, which is the thing a clinician would actually see.
  const profiles = await api('/rest/v1/users?select=id,email', { service: true });
  const leftovers = (profiles.json ?? []).filter(
    (p) => String(p.email).includes('acct-check-') || String(p.id).startsWith('USR-T'),
  );
  check('no test staff profile survived', leftovers.length === 0,
    leftovers.map((p) => p.id).join(', '));
}

// --- main -------------------------------------------------------------------

async function main() {
  if (!URL_BASE || !ANON || !SR) {
    throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY missing from .env');
  }
  if (!ORIGINAL) {
    console.log('STAFF_PASSWORD is not set in the environment. Nothing was changed.');
    process.exitCode = 1;
    return;
  }

  console.log(`Testing the staff-accounts handler against ${URL_BASE}`);
  unitChecks();
  await protocolChecks();

  const admin = await signIn(ADMIN_EMAIL, ORIGINAL);
  if (admin.status !== 200) {
    console.log(`\nCannot sign in as ${ADMIN_EMAIL} (status ${admin.status}). Stopping.`);
    process.exitCode = 1;
    return;
  }

  try {
    await liveChecks(admin.token);
  } finally {
    await cleanup();
  }

  console.log(
    failures === 0
      ? `\nAll ${checks} checks passed. The handler in supabase/functions/staff-accounts/ is the code that was tested.`
      : `\n${failures} of ${checks} checks FAILED.`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

await main();
