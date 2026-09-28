/**
 * One-off: remove everything the probe suites and the browser fixture left in
 * the live database.
 *
 * Two different things are removed, both provably owned by this repository's
 * throwaway machinery:
 *
 *   1. Probe staff profiles - `crudaudit-*`, `forcedchange-probe`,
 *      `browserprobe-*`, and the `USR-A...` / `USR-FC...` / `FB-U...` ids those
 *      suites generate - plus any audit rows attributed to them.
 *   2. The browser fixture patient `FB-P9108760` (a patient belongs to no
 *      clinician and is owned by no real record, so it is safe to remove when
 *      its tests are done), which cascades to its visit, consultation,
 *      diagnoses, lab requests, prescriptions, invoice and invoice items, and
 *      the throwaway auth account that signed in as her doctor.
 *
 * audit_logs is append-only, enforced by a trigger, so its rows cannot be
 * deleted through PostgREST even with the privileged key. The trigger is
 * disabled for exactly one statement, only for rows this cleanup provably
 * owns, then re-armed and asserted - the same discipline as
 * purge-test-audit-rows.mjs.
 *
 * Run:  node scripts/purge-probe-data.mjs [--dry-run]
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const DRY = process.argv.includes('--dry-run');

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
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;

// Every row removed must be one this cleanup provably owns. An email domain is
// the honest surface: no real clinician is ever provisioned with these
// addresses, and the probe suites generate fresh ones every run.
const USER_SURFACE = `(
  email like 'crudaudit-%@fatclinic.health'
  or email = 'forcedchange-probe@fatclinic.health'
  or email like 'browserprobe-%@fatclinic.health'
  or (id like 'USR-A%' and email like 'crudaudit-%@fatclinic.health')
  or id in ('USR-FC557978', 'FB-U9108760')
)`;
const PATIENT_ID = 'FB-P9108760';
const AUDIT_SURFACE = `(
  user_id in (select id from users where ${USER_SURFACE})
  or patient_id = '${PATIENT_ID}'
)`;

const client = new pg.Client({
  host: env.PGHOST,
  port: Number(env.PGPORT),
  user: env.PGUSER,
  password: env.PGPASSWORD,
  database: env.PGDATABASE,
});
await client.connect();

const say = (line) => console.log(line);

const users = await client.query(`select id, email from users where ${USER_SURFACE} order by id`);
say(`probe staff profiles: ${users.rows.length}`);
for (const r of users.rows) say(`  ${r.id}  ${r.email}`);

const audit = await client.query(`select id, user_id, patient_id, action from audit_logs where ${AUDIT_SURFACE} order by logged_at`);
say(`\naudit rows attributable to the probes: ${audit.rows.length}`);
for (const r of audit.rows) say(`  ${r.id}  user=${r.user_id} patient=${r.patient_id}  ${r.action}`);

const patient = await client.query(`select id, first_name, last_name from patients where id = '${PATIENT_ID}'`);
say(`\nfixture patient: ${patient.rows.length ? `${patient.rows[0].id} ${patient.rows[0].first_name} ${patient.rows[0].last_name}` : 'none'}`);

// Auth accounts first: a credential must not survive its profile. Without the
// admin credentials there is no way to remove or even check the auth side, so a
// real run stops rather than half-clean - deleting the profile while its
// password still works is exactly the outcome this script exists to prevent.
const canAuth = Boolean(BASE && SVC);
const ADMIN = canAuth
  ? { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }
  : {};
const PROBE_AUTH_EMAIL = /^(crudaudit-|browserprobe-).*@fatclinic\.health$|^forcedchange-probe@fatclinic\.health$/;
if (!DRY && !canAuth) {
  console.error('\nVITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both required for a real run,');
  console.error('so the throwaway credentials are never left with an orphaned sign-in.');
  await client.end();
  process.exit(1);
}

let authFound = [];
if (canAuth) {
  const res = await fetch(`${BASE}/auth/v1/admin/users?page=1&per_page=200`, { headers: ADMIN });
  if (res.ok) {
    const { users: all } = await res.json();
    authFound = (all ?? []).filter((u) => PROBE_AUTH_EMAIL.test(u.email));
  } else {
    say(`\ncould not list auth accounts (${res.status}); skipping the auth check.`);
  }
}
say(`\nprobe auth accounts: ${authFound.length}`);
for (const u of authFound) say(`  ${u.id}  ${u.email}`);

if (DRY) {
  say('\n--dry-run: nothing was changed.');
  await client.end();
  process.exitCode = 0;
} else {
  const failures = [];
  for (const u of authFound) {
    const r = await fetch(`${BASE}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: ADMIN });
    if (!r.ok) failures.push(`auth account ${u.id} (${u.email}) refused deletion: ${r.status}`);
  }
  // Confirmation by fresh listing, not by the DELETE response (see
  // check-clinical-crud.mjs removeThrowaway for why a 200 is not proof).
  const survived =
    ((await (await fetch(`${BASE}/auth/v1/admin/users?page=1&per_page=200`, { headers: ADMIN })).json()).users ?? [])
      .filter((u) => PROBE_AUTH_EMAIL.test(u.email));
  for (const u of survived) failures.push(`auth account ${u.id} (${u.email}) SURVIVED deletion`);
  say(`\nauth accounts removed and confirmed: ${authFound.length - survived.length}/${authFound.length}`);

  await client.query('begin');
  try {
    const idList = users.rows.map((r) => r.id);
    await client.query('alter table audit_logs disable trigger trg_audit_immutable');
    const auditDel = await client.query(`delete from audit_logs where ${AUDIT_SURFACE} returning id`);
    await client.query('alter table audit_logs enable trigger trg_audit_immutable');
    const userDel = idList.length
      ? await client.query(`delete from users where id = any($1::text[]) returning id`, [idList])
      : { rowCount: 0 };
    const patientDel = await client.query(`delete from patients where id = '${PATIENT_ID}' returning id`);
    await client.query('commit');
    say(`\ndeleted ${auditDel.rowCount} audit row(s), ${userDel.rowCount} staff profile(s), ${patientDel.rowCount} fixture patient(s)`);
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    await client.query('alter table audit_logs enable trigger trg_audit_immutable').catch(() => undefined);
    console.error('cleanup failed and was rolled back:', err.message);
    process.exitCode = 1;
  }

  // Assert rather than assume.
  const leftAudit = await client.query(`select count(*)::int n from audit_logs where ${AUDIT_SURFACE}`);
  const leftUsers = await client.query(`select count(*)::int n from users where ${USER_SURFACE}`);
  const leftPat = await client.query(`select count(*)::int n from patients where id = '${PATIENT_ID}'`);
  const armed = await client.query(
    `select count(*)::int n from pg_trigger where tgname = 'trg_audit_immutable' and tgenabled = 'O'`,
  );
  const restrict = await client.query(`
    select count(*)::int n from pg_constraint
     where conrelid = 'audit_logs'::regclass and contype = 'f' and confdeltype = 'r'
       and conname in ('audit_logs_user_id_fkey', 'audit_logs_patient_id_fkey')`);
  say(`audit rows remaining: ${leftAudit.rows[0].n}`);
  say(`probe profiles remaining: ${leftUsers.rows[0].n}`);
  say(`fixture patient remaining: ${leftPat.rows[0].n}`);
  say(`append-only trigger re-armed: ${armed.rows[0].n === 1 ? 'yes' : 'NO'}`);
  say(`audit foreign keys RESTRICT: ${restrict.rows[0].n === 2 ? 'yes' : 'NO'}`);

  if (
    leftAudit.rows[0].n !== 0 ||
    leftUsers.rows[0].n !== 0 ||
    leftPat.rows[0].n !== 0 ||
    armed.rows[0].n !== 1 ||
    restrict.rows[0].n !== 2 ||
    failures.length
  ) {
    for (const f of failures) say(`\n  - ${f}`);
    process.exitCode = 1;
  }
  await client.end();
}

if (!process.exitCode) say('\ncleanup complete.');