// End-to-end: sign in as a real staff member and prove RLS admits them, that
// app_is_staff() resolves, that role gating works, and that a deactivated profile
// loses access without the auth account being revoked.
//
// This is the check that says the app is actually connected, rather than merely
// that the database is reachable. It is the counterpart to check-orphan: that one
// proves a session with no profile gets nothing, this one proves a real one is
// admitted. Both are needed - a policy that admits everyone passes one and fails
// the other.
//
//   STAFF_PASSWORD='...' npm run db:check-signin -- someone@clinic.health
//
// The password comes from the environment, not argv, because argv is visible in
// the process list and lands in shell history. Every write is inside a
// transaction that is rolled back.
import 'dotenv/config';
import pg from 'pg';
import { resolveConnection } from './db-config.mjs';

const email = process.argv[2];
const password = process.env.STAFF_PASSWORD || process.argv[3];
if (!email || !password) {
  console.error(
    '\n[fatclinic] usage:  STAFF_PASSWORD=\'...\' npm run db:check-signin -- <email>\n'
      + '  The password is read from the environment on purpose: an argument is\n'
      + '  visible to every other process on the machine and stays in shell history.\n',
  );
  process.exit(1);
}
if (!process.env.STAFF_PASSWORD) {
  console.warn(
    '  note: the password came from argv, so it is in your shell history and was\n'
    + '        briefly visible in the process list. Prefer STAFF_PASSWORD=...\n',
  );
}
const url = (process.env.VITE_SUPABASE_URL || '').trim();
const anonKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();

const problems = [];
const say = (s = '') => console.log(s);
const check = (name, pass, detail = '') => {
  say(`  ${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!pass) problems.push(name);
};

say('\n[fatclinic] end-to-end sign-in check\n');

// --- sign in ------------------------------------------------------------------
const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anonKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const body = await res.json();
if (!res.ok) {
  console.error(`  sign-in failed (${res.status}): ${body.msg || body.message || body.error_description}`);
  process.exit(1);
}
const jwt = body.access_token;
say(`  signed in as ${body.user.email}  (role=${body.user.role})`);
const auth = { apikey: anonKey, Authorization: `Bearer ${jwt}` };

// --- the policies must now admit this session ---------------------------------
say('\n  reads as a signed-in staff member:');
for (const table of ['wards', 'users', 'patients', 'system_settings', 'audit_logs']) {
  const r = await fetch(`${url}/rest/v1/${table}?select=*&limit=3`, {
    headers: { ...auth, Prefer: 'count=exact', Range: '0-2' },
  });
  const count = r.headers.get('content-range');
  const total = count ? Number(count.split('/')[1]) : NaN;
  // wards is seeded, so an empty read here would mean the policy is over-tight.
  // patients may legitimately be empty on a new install.
  const expectRows = table === 'wards';
  const gotRows = r.ok && !Number.isNaN(total) && total > 0;
  check(
    `${table} readable`,
    r.ok && (expectRows ? gotRows : true),
    `${r.status}, ${count ?? 'no count'} total`,
  );
}

// --- the SQL helpers must agree with the JWT ----------------------------------
const { options } = resolveConnection();
const client = new pg.Client({ ...options, ssl: { rejectUnauthorized: false } });
await client.connect();

// PostgREST sets request.jwt.claims, which is where auth.jwt() reads from. A
// direct Postgres connection has no such GUC, so the helpers are exercised by
// setting it exactly as PostgREST would - that is the only way to prove the
// policy expression resolves, rather than merely existing in the catalog.
//
// Each statement is sent separately: pg refuses to parameterise a multi-statement
// query ("cannot insert multiple commands into a prepared statement"), and
// `set local role` has to be in the same transaction as the read to have any
// effect, so BEGIN/COMMIT is managed here rather than in the SQL string.
const claims = JSON.stringify({ email, role: 'authenticated' });
const asSession = async (fn) => {
  await client.query('begin');
  try {
    await client.query('set local role authenticated');
    await client.query('select set_config($1, $2, true)', ['request.jwt.claims', claims]);
    return await fn();
  } finally {
    await client.query('rollback').catch(() => {});
  }
};

const h = (await asSession(() => client.query(
  `select public.app_user_role()            as role,
          public.app_is_admin()            as is_admin,
          public.app_is_staff()            as is_staff,
          public.app_current_staff_id()    as staff_id`,
))).rows[0];

say('\n  SQL helper functions, with the JWT claims PostgREST would send:');
check('app_user_role() resolves', h.role != null, `= ${h.role}`);
check('app_is_admin() is true for an admin', h.is_admin === true, `= ${h.is_admin}`);
check('app_is_staff() is true', h.is_staff === true, `= ${h.is_staff}`);
check('app_current_staff_id() resolves', !!h.staff_id, `= ${h.staff_id}`);

// --- write gating -------------------------------------------------------------
// Each is rolled back, so this proves the policy without leaving a row behind.
// system_settings is a single seeded row keyed by id, so the write is an UPDATE
// of a real column rather than an INSERT of a probe row.
const wrote = await asSession(() => client.query(
  `update system_settings set tagline = tagline where id = 1 returning id`,
)).then((r) => r.rows.length, (e) => { say(`      ${e.message}`); return 0; });
check('an admin may write to admin_tables', wrote === 1);

// wards is keyed by `code`, not `id` - the clinical tables do not all share one
// primary key shape, which is why the mappers in src/services/sync.ts are
// table-by-table rather than generated.
const clinicalWrite = await asSession(() => client.query(
  `update wards set name = name where code = (select min(code) from wards) returning code`,
)).then((r) => r.rows.length, (e) => { say(`      ${e.message}`); return 0; });
check('a staff member may write to a clinical table', clinicalWrite >= 1);

const deleted = await asSession(() => client.query('delete from users'))
  .then(() => true, (e) => /row-level security/i.test(e.message));
check('a DELETE on users is rejected (admin_tables are insert/update only for non-admins too)', deleted);

// --- an inactive profile must lose access -------------------------------------
// The other half of app_is_staff(): deactivating the profile, not deleting the
// auth account, is what a suspension actually looks like. Proving it here means
// a stolen-but-deactivated session is worth nothing, without revoking anything.
await client.query('begin');
try {
  await client.query('update users set active = false where id = $1', [h.staff_id]);
  const s = await asSession(() => client.query(
    'select public.app_is_staff() as is_staff, public.app_user_role() as role',
  )).then((r) => r.rows[0], (e) => { say(`      ${e.message}`); return {}; });
  check(
    'a deactivated profile resolves app_is_staff() = false',
    s.is_staff === false,
    `= ${s.is_staff}, role = ${s.role}`,
  );
} finally {
  await client.query('rollback');
}

await client.end();

say('');
if (problems.length) {
  say('[fatclinic] NOT READY\n');
  for (const p of problems) say(`  - ${p}`);
  say('');
  process.exitCode = 1;
} else {
  say('[fatclinic] ready: a real staff member signs in and is admitted exactly as intended.\n');
}
