/**
 * Live check: a clinician can update only their own profile details and PIN,
 * through the app_update_own_profile function, while `public.users` stays an
 * admin table.
 *
 *   npm run db:check-self-edit
 *
 * Proves, with a real throwaway clinician and a real JWT:
 *   - the RPC updates name / department / avatar / pin on the caller's row
 *   - email, role, active and auth_user_id are untouched by it
 *   - an empty name and a malformed PIN are refused, and nothing is half-saved
 *   - a NULL argument leaves that column alone
 *   - a direct UPDATE of public.users as a non-admin still matches no policy
 *     (RLS is the gate; the function is a narrow exception, not a widening)
 *   - an anonymous caller cannot invoke the function at all
 *
 * Needs the same .env entries as check-clinical-crud.mjs: PGHOST/PGPASSWORD,
 * VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY.
 */
import { readFileSync } from 'node:fs';
import { resolveConnection, shouldUseSsl } from './db-config.mjs';
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

const missing = ['PGHOST', 'PGPASSWORD', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !env[k]);
if (missing.length) {
  console.error(`Missing from .env: ${missing.join(', ')}. See .env.example.`);
  process.exit(1);
}

const BASE = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };

const stamp = Date.now().toString().slice(-8);
const EMAIL = `crudaudit-${stamp}@fatclinic.health`; // reuses the probe surface the sweep and purge know
const PASSWORD = `Audit-${stamp}!Rampart7`;
const PROFILE = `USR-A${stamp}`;

const { options } = resolveConnection(env);
const sql = new pg.Client({ ...options, ssl: shouldUseSsl(options, env) ? { rejectUnauthorized: false } : undefined });

let checks = 0;
let failures = 0;
let throwawayId = null;
let throwawayNote = null;

const check = (name, ok, detail) => {
  checks++;
  if (!ok) {
    failures++;
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  } else {
    console.log(`  ok    ${name}`);
  }
};

async function removeThrowaway() {
  if (!throwawayId) return throwawayNote ?? 'no throwaway sign-in account was ever created';
  const id = throwawayId;
  let res;
  try {
    res = await fetch(`${BASE}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: ADMIN });
  } catch (err) {
    throwawayNote = `the throwaway account could not be reached to delete it (${err.message}); remove ${EMAIL} by hand`;
    return throwawayNote;
  }
  if (!res.ok) {
    throwawayNote = `the throwaway account refused deletion (${res.status} ${await res.text()}); remove ${EMAIL} by hand`;
    return throwawayNote;
  }
  const still = ((await (await fetch(`${BASE}/auth/v1/admin/users?page=1&per_page=200`, { headers: ADMIN })).json()).users ?? [])
    .some((u) => u.email === EMAIL);
  throwawayNote = still
    ? `WARNING: the throwaway account ${EMAIL} SURVIVED deletion and must be removed by hand`
    : 'removed the throwaway sign-in account, and confirmed it is gone';
  if (still) failures++;
  else throwawayId = null;
  return throwawayNote;
}

let alreadyHandled = false;
const onFatal = (what, err) => {
  if (alreadyHandled) return;
  alreadyHandled = true;
  fs.writeSync(2, `\n  FATAL: ${what}\n${err?.stack ? `${err.stack}\n` : ''}`);
  removeThrowaway().then(
    (outcome) => {
      fs.writeSync(2, `  ${outcome}\n`);
      process.exit(1);
    },
    (e) => {
      fs.writeSync(2, `  could not remove the throwaway account: ${e.message}\n  delete ${EMAIL} by hand\n`);
      process.exit(1);
    },
  );
};
process.on('uncaughtException', (err) => onFatal('the run died on an uncaught error', err));
process.on('unhandledRejection', (err) => onFatal('the run died on an unhandled rejection', err));

async function bootstrap() {
  await sql.connect();

  // Reap crash-left probes from earlier suites, exactly as
  // check-clinical-crud.mjs does, so one dying run never builds up a pile.
  const { rows: leftover } = await sql.query(
    `select id from users
      where id like 'USR-A%'
         or email like 'crudaudit-%@fatclinic.health'
         or id = 'USR-FC557978' or email = 'forcedchange-probe@fatclinic.health'
         or id = 'FB-U9108760' or email like 'browserprobe-%@fatclinic.health'`,
  );
  if (leftover.length) {
    const ids = leftover.map((r) => r.id);
    console.log(`  sweeping ${leftover.length} leftover probe profile(s): ${ids.join(', ')}`);
    await sql.query('alter table audit_logs disable trigger trg_audit_immutable');
    try {
      await sql.query(
        `delete from audit_logs where user_id = any($1::text[]) or patient_id = 'FB-P9108760'`,
        [ids],
      );
    } finally {
      await sql.query('alter table audit_logs enable trigger trg_audit_immutable');
    }
    await sql.query(`delete from users where id = any($1::text[])`, [ids]);
    const probeAuth = ((await (await fetch(`${BASE}/auth/v1/admin/users?page=1&per_page=200`, { headers: ADMIN })).json()).users ?? [])
      .filter((u) => /^(crudaudit-|browserprobe-).*@fatclinic\.health$|^forcedchange-probe@fatclinic\.health$/.test(u.email));
    for (const u of probeAuth) await fetch(`${BASE}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: ADMIN });
    const still = ((await (await fetch(`${BASE}/auth/v1/admin/users?page=1&per_page=200`, { headers: ADMIN })).json()).users ?? [])
      .filter((u) => /^(crudaudit-|browserprobe-).*@fatclinic\.health$|^forcedchange-probe@fatclinic\.health$/.test(u.email));
    if (still.length) console.error(`  WARNING: ${still.map((u) => u.email).join(', ')} survived the sweep`);
  }

  try {
    await sql.query(
      `insert into users (id, name, email, role, active, must_change_password)
       values ($1, 'CRUD Audit', $2, 'PHYSICIAN', true, false)`,
      [PROFILE, EMAIL.toLowerCase()],
    );

    const created = await fetch(`${BASE}/auth/v1/admin/users`, {
      method: 'POST',
      headers: ADMIN,
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
    });
    if (!created.ok) {
      console.error(`  could not create the throwaway sign-in account: ${created.status} ${await created.text()}`);
      failures++;
      await sql.end();
      return;
    }
    throwawayId = (await created.json()).id;
    // Link the profile to its credential, as real provisioning does, so the
    // "auth_user_id untouched" assertion is meaningful: the RPC must not be able
    // to re-point it.
    await sql.query(`update users set auth_user_id = $1 where id = $2`, [throwawayId, PROFILE]);

    const grant = await (
      await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      })
    ).json();
    if (!grant.access_token) {
      console.error('  could not sign the throwaway account in');
      failures++;
      await sql.end();
      return;
    }
    const AUTH = { apikey: ANON, Authorization: `Bearer ${grant.access_token}`, 'Content-Type': 'application/json' };

    const row = async () => (await sql.query(`select * from users where id = $1`, [PROFILE])).rows[0];

    const rpc = async (payload) =>
      fetch(`${BASE}/rest/v1/rpc/app_update_own_profile`, {
        method: 'POST',
        headers: AUTH,
        body: JSON.stringify(payload),
      });

    console.log('\n  RPC happy path - the caller updates their own columns');
    const r1 = await rpc({ p_name: 'Renamed Clinician', p_department: 'Radiology', p_avatar: '🩻', p_pin: '4321' });
    const d1 = await r1.text();
    check('app_update_own_profile resolves TRUE', r1.status === 200 && d1 === 'true', `${r1.status} ${d1}`);

    const after1 = await row();
    check('name stored', after1.name === 'Renamed Clinician', after1.name);
    check('department stored', after1.department === 'Radiology', after1.department);
    check('avatar stored', after1.avatar === '🩻', after1.avatar);
    check('PIN stored', after1.pin === '4321', after1.pin);
    check('email untouched', after1.email === EMAIL.toLowerCase(), after1.email);
    check('role untouched', after1.role === 'PHYSICIAN', after1.role);
    check('active untouched', after1.active === true, after1.active);
    check('auth_user_id untouched', after1.auth_user_id === throwawayId, after1.auth_user_id);

    console.log('\n  RPC refuses a malformed PIN and an empty name');
    const r2 = await rpc({ p_name: null, p_department: null, p_avatar: null, p_pin: '12' });
    const d2 = await r2.json();
    check('non-4-digit PIN is refused', r2.status === 400 && /4 digits/.test(d2.message ?? ''), `${r2.status} ${JSON.stringify(d2)}`);
    check('PIN unchanged after refusal', (await row()).pin === '4321', (await row()).pin);

    const r3 = await rpc({ p_name: '   ', p_department: null, p_avatar: null, p_pin: null });
    const d3 = await r3.json();
    check('blank name is refused', r3.status === 400 && /name cannot be empty/.test(d3.message ?? ''), `${r3.status} ${JSON.stringify(d3)}`);
    check('name unchanged after refusal', (await row()).name === 'Renamed Clinician', (await row()).name);

    console.log('\n  NULL argument leaves that column alone');
    const r4 = await rpc({ p_name: 'Solo Name Pet', p_department: null, p_avatar: null, p_pin: null });
    const d4 = await r4.text();
    const after4 = await row();
    check('partial call resolves TRUE', r4.status === 200 && d4 === 'true', `${r4.status} ${d4}`);
    check('name updated alone', after4.name === 'Solo Name Pet', after4.name);
    check('previous PIN survived', after4.pin === '4321', after4.pin);
    check('previous department survived', after4.department === 'Radiology', after4.department);

    console.log('\n  RLS still gates public.users - the function is a narrow exception');
    // With Prefer: return=representation, PostgREST returns 200 with a JSON
    // array of the rows it actually changed. RLS filtering everything out yields
    // an empty array - the proof no write slipped through. A 204 means no
    // representation (also no row). The DB row stays the source of truth either
    // way.
    const changedRows = async (res) => {
      if (res.status === 204) return 0;
      try {
        const arr = JSON.parse(await res.text());
        return Array.isArray(arr) ? arr.length : 1;
      } catch {
        return 1;
      }
    };
    const patchMine = await fetch(`${BASE}/rest/v1/users?id=eq.${PROFILE}`, {
      method: 'PATCH',
      headers: { ...AUTH, Prefer: 'return=representation' },
      body: JSON.stringify({ pin: '1111' }),
    });
    check('direct self-UPDATE of users as a non-admin touches no row', (await changedRows(patchMine)) === 0, `status ${patchMine.status}`);
    check('PIN unchanged by the refused direct write', (await row()).pin === '4321', (await row()).pin);

    const patchOther = await fetch(`${BASE}/rest/v1/users?id=eq.USR-001`, {
      method: 'PATCH',
      headers: { ...AUTH, Prefer: 'return=representation' },
      body: JSON.stringify({ pin: '1111' }),
    });
    const otherRow = (await sql.query(`select pin from users where id = 'USR-001'`)).rows[0];
    check('direct UPDATE of another staff row touches nothing', (await changedRows(patchOther)) === 0, `status ${patchOther.status}`);
    check('the other row is untouched', otherRow.pin !== '1111', otherRow.pin);

    console.log('\n  an anonymous caller cannot reach the function');
    const anon = await fetch(`${BASE}/rest/v1/rpc/app_update_own_profile`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_name: null, p_department: null, p_avatar: null, p_pin: '0000' }),
    });
    check('anon is refused', anon.status === 401 || anon.status === 403 || anon.status === 404, `status ${anon.status}`);
  } finally {
    console.log('\n  cleaning up');
    await sql.query(`delete from users where id = $1`, [PROFILE]).catch(() => {});
    const outcome = await removeThrowaway();
    console.log(`    ${outcome}`);
    const left = await sql.query(
      `select (select count(*)::int from users where id = $1) +
              (select count(*)::int from audit_logs where user_id = $1) as n`,
      [PROFILE],
    );
    check('nothing this check created is left behind', left.rows[0].n === 0, `${left.rows[0].n} row(s) remain`);
    await sql.end();
  }
}

await bootstrap();

console.log('');
if (!checks) {
  console.log('[self-edit check] the check failed before any assertion could run');
  process.exitCode = 1;
} else if (failures) {
  console.log(`[self-edit check] ${failures} of ${checks} checks FAILED`);
  process.exitCode = 1;
} else {
  console.log(`[self-edit check] all ${checks} checks behaved as expected`);
}