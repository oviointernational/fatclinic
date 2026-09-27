/**
 * The recovery secret must stay unreadable by colleagues.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * Password recovery asks for three things: the address, the workstation PIN,
 * and the account's own `auth_user_id`. The address is not a secret and the PIN
 * is readable by every signed-in staff member, because the application has to
 * be able to compare it in the browser to unlock a screen. So the whole check
 * rests on the third one being unreadable.
 *
 * It was not. `users` sits in `admin_tables` with a SELECT policy of
 * `app_is_staff()`, so any signed-in clinician could run
 * `SELECT pin, auth_user_id FROM users` and get the administrator's - measured
 * on this project with a throwaway PHYSICIAN account, which is how the hole was
 * found. Any clinician could then have reset the administrator's password and
 * become an administrator.
 *
 * The fix is a column-level grant in database/fatclinic.sql. Grants are
 * permissive and quiet: nothing breaks when one is widened, and the widening
 * that reintroduces this hole is a one-word edit. This script is the thing that
 * notices, by asking the live database rather than reading the SQL.
 *
 * It creates a throwaway physician, proves what that account can and cannot
 * read, then removes it. Nothing here touches a real account.
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
const ADMIN = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
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
  id: `USR-Z${stamp}`, // users.id has no default and no CHECK, so the script picks one
  name: 'Recovery Secret Probe',
  email: `recovery-probe-${stamp}@fatclinic.health`,
  password: `Probe-${stamp}!Vault7`,
};

const rest = (path, init = {}) =>
  fetch(`${BASE}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: ANON, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });

const signIn = async (email, password) => {
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: r.status, body: await r.json() };
};

const db = new pg.Client({
  host: env.PGHOST, port: Number(env.PGPORT), user: env.PGUSER,
  password: env.PGPASSWORD, database: env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

/** Create the throwaway profile + auth account, and return its ids. */
async function createProbe() {
  const ins = await db.query(
    `INSERT INTO users (id, name, email, role, department, avatar, pin)
     VALUES ($1, $2, $3, 'PHYSICIAN', 'Records', '🧑‍⚕️', '4821') RETURNING id`,
    [PROBE.id, PROBE.name, PROBE.email],
  );
  const profileId = ins.rows[0].id;

  const made = await fetch(`${BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { ...ADMIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: PROBE.email, password: PROBE.password, email_confirm: true }),
  });
  const authUser = await made.json();
  if (!made.ok) throw new Error(`could not create the probe account: ${JSON.stringify(authUser)}`);

  await db.query('UPDATE users SET auth_user_id = $1 WHERE id = $2', [authUser.id, profileId]);
  return { profileId, authUserId: authUser.id };
}

async function removeProbe(profileId, authUserId) {
  await fetch(`${BASE}/auth/v1/admin/users/${authUserId}`, { method: 'DELETE', headers: ADMIN });
  await db.query('DELETE FROM users WHERE id = $1', [profileId]);
}

let probe = null;
try {
  probe = await createProbe();
} catch (err) {
  console.error(`\nCould not set up the probe account: ${err.message}`);
  console.error('Nothing below can be trusted, so stopping here rather than reporting noise.');
  process.exitCode = 1;
  await db.end();
}

// --- 1. What a signed-in physician can read ---------------------------------
console.log('\nA signed-in physician, over PostgREST (the only path that matters)');
const { status: signInStatus, body: session } = await signIn(PROBE.email, PROBE.password);
const signedIn = signInStatus === 200 && Boolean(session?.access_token);
check('the throwaway physician can sign in', signedIn, `status ${signInStatus}`);

const asProbe = (path) => rest(path, { headers: { Authorization: `Bearer ${session.access_token}` } });

// The whole table, exactly as the application used to ask for it. This is the
// call that leaked every identifier on the project.
//
// `signedIn` is part of the assertion on purpose. A signed-out request is
// refused too, and a refusal is what this check is looking for - so without it
// this would pass with no probe at all, which is the one way a check like this
// can lie to you.
const star = await asProbe('users?select=*');
check(
  'selecting the whole users table is refused, not quietly trimmed',
  signedIn && star.status !== 200,
  `signed in: ${signedIn}, status ${star.status}` +
    (star.status === 200 ? ' - the grant was widened and the app must be told to ask for columns' : ''),
);
const starBody = await star.text();
const starCode = (() => { try { return JSON.parse(starBody).code; } catch { return null; } })();
check(
  'the refusal is a privilege error, not a silently trimmed result',
  signedIn && starCode === '42501',
  `PGRST code ${starCode}`,
);

// Naming the secret outright has to fail too, not just `*`.
const direct = await asProbe('users?select=id,pin,auth_user_id');
check('asking for auth_user_id by name is refused', direct.status !== 200, `status ${direct.status}`);

const anon = await rest('users?select=id,pin,auth_user_id');
check('a signed-out reader is refused too', anon.status >= 400, `status ${anon.status}`);

// --- 2. What must still work, or the app breaks -----------------------------
console.log('\nWhat the application still has to be able to do');
const readable = await asProbe(
  'users?select=id,name,email,role,department,avatar,pin,custom_role_id,must_change_password,active',
);
const rows = readable.status === 200 ? await readable.json() : null;
check('the granted column list still reads', Array.isArray(rows), `status ${readable.status}`);
check('every staff profile is returned, not just their own', (rows?.length ?? 0) >= 3, `${rows?.length} rows`);
check(
  'the granted list includes every column the app maps',
  rows?.every((r) => r.pin !== undefined && r.must_change_password !== undefined && r.active !== undefined),
);
check(
  'no row carries the identifier',
  rows?.every((r) => r.auth_user_id === undefined),
);
check(
  'the application can still read a colleague\'s PIN, which the screen lock needs',
  rows?.some((r) => typeof r.pin === 'string' && /^\d{4}$/.test(r.pin)),
);

// Writing must survive a narrower SELECT grant. A physician is refused, and
// that is the pre-existing policy rather than anything to do with this change -
// `users` is admin-only to write. What matters here is that the grant change did
// not narrow INSERT/UPDATE, so the check is made as the role that is allowed to
// write at all: the privileged one the Edge Function uses.
const physicianWrite = await asProbe(`users?id=eq.${probe.profileId}`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${session.access_token}`, Prefer: 'return=minimal' },
  body: JSON.stringify({ department: 'Records (probed)' }),
});
check(
  'a physician still cannot write a staff profile',
  physicianWrite.status === 403,
  `status ${physicianWrite.status}`,
);

const asAdmin = (path, init = {}) =>
  fetch(`${BASE}/rest/v1/${path}`, {
    ...init,
    headers: { ...ADMIN, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });

const adminWrite = await asAdmin(`users?id=eq.${probe.profileId}`, {
  method: 'PATCH',
  headers: { Prefer: 'return=minimal' },
  body: JSON.stringify({ department: 'Records (probed)' }),
});
check('an administrator can still write, so upserts do not break', adminWrite.ok, `status ${adminWrite.status}`);

// The one reader that must still see the secret: the Edge Function, which is
// how recovery is verified at all. If the revoke ever reached service_role the
// feature would break in a way that looks like "details never match".
const privilegedRead = await asAdmin('users?id=eq.' + probe.profileId + '&select=auth_user_id');
const privilegedRows = privilegedRead.ok ? await privilegedRead.json() : null;
check(
  'the Edge Function can still read the identifier, or recovery can never work',
  privilegedRows?.[0]?.auth_user_id === probe.authUserId,
  privilegedRead.ok ? `${privilegedRows?.[0]?.auth_user_id}` : `status ${privilegedRead.status}`,
);
await db.query('UPDATE users SET department = $1 WHERE id = $2', ['Records', probe.profileId]);

// --- 3. The grant itself, read from the catalogue ---------------------------
// The checks above prove the behaviour. This one proves the *shape* of the
// grant, so a future column added to `users` and swept into the list by a
// careless edit shows up even if no test happens to read that column.
console.log('\nThe grant, read from the catalogue');
const granted = await db.query(
  `SELECT column_name
     FROM information_schema.column_privileges
    WHERE table_schema = 'public' AND table_name = 'users'
      AND grantee = 'authenticated' AND privilege_type = 'SELECT'
    ORDER BY column_name`,
);
const grantedColumns = granted.rows.map((r) => r.column_name);
const expected = [
  'active', 'avatar', 'custom_role_id', 'department', 'email', 'id', 'must_change_password',
  'name', 'pin', 'role',
].sort();
check('the granted columns are exactly the expected list', JSON.stringify(grantedColumns) === JSON.stringify(expected),
  `granted: ${grantedColumns.join(', ')}`);

const tableLevel = await db.query(
  `SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'users'
      AND grantee = 'authenticated' AND privilege_type = 'SELECT'`,
);
check(
  'there is no table-wide SELECT, which would beat the column revoke',
  tableLevel.rowCount === 0,
  tableLevel.rowCount ? 'a table-level grant silently overrides the column list' : '',
);

const everyColumn = await db.query(
  `SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' ORDER BY column_name`,
);
const ungranted = everyColumn.rows.map((r) => r.column_name).filter((c) => !grantedColumns.includes(c));
check(
  'the only columns left unreadable are deliberate ones',
  ungranted.every((c) => ['auth_user_id', 'created_at', 'updated_at'].includes(c)),
  `ungranted: ${ungranted.join(', ')}`,
);

// --- 4. The self-only function ---------------------------------------------
console.log('\nReading your own identifier');
const own = await asProbe('rpc/app_own_account_id');
const ownId = own.status === 200 ? (await own.json()) : null;
check('a signed-in person gets their own identifier', ownId === probe.authUserId, `${ownId}`);

// A signed-out caller must get nothing back. Status is not the point here: the
// function returns NULL rather than erroring, because an unrecognised token is
// not a failure to report. The value is the security property.
const signedOut = await rest('rpc/app_own_account_id');
const signedOutValue = signedOut.status === 200 ? await signedOut.json() : 'refused';
check(
  'a signed-out reader gets no identifier',
  signedOutValue === null || signedOutValue === 'refused',
  `${JSON.stringify(signedOutValue)} (status ${signedOut.status})`,
);

// It must be impossible to aim at a colleague, which is the whole reason this is
// a function and not a column grant. PostgREST rejects an argument to a
// zero-argument function outright, so a 400 here is the proof.
const aimed = await asProbe('rpc/app_own_account_id?id=eq.' + PROBE.id);
check(
  'it takes no argument, so it cannot be aimed at a colleague',
  aimed.status === 400,
  `status ${aimed.status}`,
);

const functionPrivileges = await db.query(
  `SELECT has_function_privilege('public', p.oid, 'EXECUTE') AS public_can_execute
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'app_own_account_id'`,
);
check('the function is defined', functionPrivileges.rowCount === 1);
check('PUBLIC cannot execute it directly', functionPrivileges.rows[0]?.public_can_execute === false);

const anonExecute = await db.query(
  `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS can_execute
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'app_own_account_id'`,
);
check(
  'and neither can the signed-out role, so it is not an open door that happens to return NULL',
  anonExecute.rows[0]?.can_execute === false,
);

// --- Teardown ---------------------------------------------------------------
await removeProbe(probe.profileId, probe.authUserId);
const residue = await db.query('SELECT count(*)::int AS n FROM users WHERE id = $1', [probe.profileId]);
check('the probe profile is gone', residue.rows[0].n === 0);
const accounts = await (await fetch(`${BASE}/auth/v1/admin/users?page=1&per_page=200`, { headers: ADMIN })).json();
check('the probe auth account is gone', !(accounts.users ?? []).some((u) => u.email === PROBE.email));

await db.end();
console.log(
  failures === 0
    ? '\nA colleague cannot read your identifier. You can read your own. The app still works.'
    : `\n${failures} check(s) failed.`,
);
if (failures) process.exitCode = 1;
