/**
 * The sign-in path itself: can a real staff member still read their own profile?
 *
 * WHY THIS EXISTS
 * ---------------
 * A change to the database grants once broke sign-in for every user on the
 * project, and the error the app showed was "Could not reach the sign-in
 * service" - which sent the hunt in the wrong direction entirely.
 *
 * The cause was a column-level REVOKE on public.users. That is correct in
 * principle, but src/services/auth.ts fetches the signed-in person's profile with
 * a bare `select *`, and in Postgres a `SELECT *` that touches a column the
 * caller has no privilege on is refused outright. The refusal arrived as a
 * PostgREST error, fetchProfile() has no way to tell that apart from the network
 * being down, and reported `unreachable`.
 *
 * Two things made it possible to ship that: the column grant was verified by a
 * suite that exercised the *sync* query, which asks for an explicit column list,
 * and nobody asked whether the second, older `select *` - the one on the sign-in
 * path - still worked. So this script does exactly that and nothing else. It is
 * deliberately narrow: one query, the one login cannot do without.
 *
 * It signs in for real as a throwaway clinician, because a session is the only
 * thing that makes the query meaningful, and RLS cannot be reasoned about from
 * a schema file. Everything it creates is removed afterwards, and it asserts that.
 *
 * Run:  npm run db:check-profile-lookup
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return i === -1
        ? [l.trim(), '']
        : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const BASE = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const ADMIN = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ''}`);
    failures += 1;
  }
};

const stamp = Date.now();
const PROBE = {
  id: `USR-P${stamp}`,
  name: 'Sign-in Path Probe',
  email: `signin-probe-${stamp}@solacemedicares.com`,
  password: `Probe-${stamp}!Vault7`,
};

const db = new pg.Client({
  host: env.PGHOST,
  port: Number(env.PGPORT),
  user: env.PGUSER,
  password: env.PGPASSWORD,
  database: env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

// --- Setup ------------------------------------------------------------------
const ins = await db.query(
  `INSERT INTO users (id, name, email, role, department, avatar, pin)
   VALUES ($1, $2, $3, 'PHYSICIAN', 'Records', '🧑‍⚕️', '6127') RETURNING id`,
  [PROBE.id, PROBE.name, PROBE.email],
);
const profileId = ins.rows[0].id;

const made = await fetch(`${BASE}/auth/v1/admin/users`, {
  method: 'POST',
  headers: ADMIN,
  body: JSON.stringify({
    email: PROBE.email,
    password: PROBE.password,
    email_confirm: true,
  }),
});
const authUser = await made.json();
if (!made.ok) {
  console.error(`\nCould not create the probe account: ${JSON.stringify(authUser)}`);
  process.exitCode = 1;
  await db.end();
}
await db.query('UPDATE users SET auth_user_id = $1 WHERE id = $2', [authUser.id, profileId]);

// --- Sign in for real -------------------------------------------------------
console.log('\nSigning in for real');
const token = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: PROBE.email, password: PROBE.password }),
})
  .then((r) => r.json())
  .then((b) => b?.access_token);

check('the throwaway clinician can sign in', Boolean(token));

if (token) {
  // The exact query src/services/auth.ts runs. If this stops working, every
  // sign-in on the project fails with "Could not reach the sign-in service".
  const profile = await fetch(
    `${BASE}/rest/v1/users?select=*&email=ilike.${encodeURIComponent(PROBE.email)}&limit=5`,
    { headers: { apikey: ANON, Authorization: `Bearer ${token}` } },
  );

  check(
    'a signed-in staff member can still run `select *` on users',
    profile.status === 200,
    `status ${profile.status} - this is the query sign-in depends on; a grant change that makes it fail breaks every login`,
  );

  const body = profile.status === 200 ? await profile.json() : [];
  const row = (body ?? []).find(
    (r) => String(r.email ?? '').trim().toLowerCase() === PROBE.email.toLowerCase(),
  );
  check('and it returns the row that matches the address typed at sign-in', Boolean(row));
  check('with the fields the profile model needs', Boolean(row?.id && row?.name && row?.role));
  check('and the row is the one that was created', row?.id === profileId, `${row?.id}`);
}

// --- The grant itself, so the cause is named rather than guessed -----------
console.log('\nThe grant, read from the catalogue');
const tableGrant = await db.query(
  `SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'users'
      AND grantee = 'authenticated' AND privilege_type = 'SELECT'`,
);
check(
  'authenticated has a table-wide SELECT on users, which is what `select *` needs',
  tableGrant.rowCount === 1,
  tableGrant.rowCount ? '' : 'a column list instead will make fetchProfile() report "unreachable"',
);

const anonWrite = await db.query(
  `SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'users'
      AND grantee = 'anon'`,
);
check('and the signed-out role still has nothing', anonWrite.rowCount === 0);

// --- Teardown ---------------------------------------------------------------
await fetch(`${BASE}/auth/v1/admin/users/${authUser.id}`, { method: 'DELETE', headers: ADMIN });
await db.query('DELETE FROM users WHERE id = $1', [profileId]);
const left = await db.query('SELECT count(*)::int AS n FROM users WHERE id = $1', [profileId]);
check('the probe profile is gone', left.rows[0].n === 0);
const accounts = await (
  await fetch(`${BASE}/auth/v1/admin/users?page=1&per_page=200`, { headers: ADMIN })
).json();
check('the probe auth account is gone', !(accounts.users ?? []).some((u) => u.email === PROBE.email));
// The total is reported, not asserted. It was pinned to exactly 2, which caught a
// real leak - a `crudaudit-` account left behind by a run that died before its
// `finally` - and would equally have failed the build the day a third clinician
// was hired, which is not a defect in anything. What is asserted is that no probe
// account is left; the count is here so the number is visible rather than guessed.
console.log(`  the project has ${(accounts.users ?? []).length} auth account(s) in total`);

await db.end();
console.log(
  failures === 0
    ? '\nA real sign-in still reads its own profile. That is the whole check.'
    : `\n${failures} check(s) failed.`,
);
if (failures) process.exitCode = 1;
