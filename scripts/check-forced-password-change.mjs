#!/usr/bin/env node
/**
 * db:check-forced-password-change
 *
 * The first sign-in after an administrator has issued a password must let the
 * person replace it themselves, and the workstation must open afterwards. That
 * is the whole feature, and it was broken in a way nothing else noticed.
 *
 * HOW IT BROKE, because the shape of the bug is the reason for this file
 * ---------------------------------------------------------------------
 * `public.users` is an admin table: its UPDATE policy requires
 * `app_is_admin()`. A clinician changing their own profile matches no policy, so
 * the write does nothing - silently, returning zero rows and no error - and the
 * offline store's own upsert is refused outright with 42501. The flag
 * `must_change_password` therefore could not be cleared by the only person who
 * was ever going to clear it.
 *
 * The result looked like a network fault. The password change *succeeded* in
 * Supabase, the "choose your password" screen stayed up because the flag never
 * cleared, and the second attempt was refused because the password had already
 * changed. Every layer above the database reported success. The user saw "The
 * password could not be changed. Contact Administration." and was sent to an
 * administrator to report a fault with a password that had in fact just been set
 * correctly, by a workstation that could not be unlocked at all.
 *
 * WHAT IS ASSERTED
 * ----------------
 * Against the live project, with a real sign-in and a real auth account:
 *   - the function exists, and only `authenticated` may execute it
 *   - a clinician can clear their own flag, and the database says so
 *   - nobody else's row is touched
 *   - it cannot be used to change a role, deactivate an account, or reach
 *     another person
 *   - anon cannot call it at all
 *   - the whole user journey: admin issues a password, the user signs in with
 *     it, chooses their own, and the profile is left clear
 *   - "already have that password" is reported as such, not as a fault needing
 *     an administrator
 *   - a clinician still cannot write the users table by any other route, which
 *     is the condition that made this necessary and the reason it is not fixed
 *     by widening a policy
 *
 * Needs: service_role (to create and delete the throwaway account).
 * Run:   npm run db:check-forced-password-change
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const BASE = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };

const stamp = Date.now().toString().slice(-8);
const EMAIL = `forcedcheck-${stamp}@fatclinic.health`;
const ISSUED = `Issued-${stamp}!Harbour3`;
const CHOSEN = `Chosen-${stamp}!Lantern8`;
const PROFILE = `USR-FC${stamp}`;

let failures = 0;
const check = (what, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${ok || !detail ? '' : `\n        ${detail}`}`);
  if (!ok) failures++;
};

const rpc = 'app_clear_own_must_change_password';

const db = new pg.Client({
  host: env.PGHOST, port: Number(env.PGPORT), user: env.PGUSER,
  password: env.PGPASSWORD, database: env.PGDATABASE, ssl: { rejectUnauthorized: false },
});
await db.connect();

let authId = null;

const row = async () =>
  (await db.query('SELECT role, active, must_change_password FROM users WHERE email = $1', [EMAIL])).rows[0];

const allRows = async () =>
  (await db.query('SELECT email, must_change_password FROM users WHERE id <> $1 ORDER BY email', [PROFILE])).rows;

const before = await allRows();

try {
  // --- the function's shape ------------------------------------------------
  const fn = await db.query(
    `SELECT p.prosecdef, p.provolatile, p.proconfig::text AS config, p.pronargs
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = $1`,
    [rpc],
  );
  check('the function exists in the database', fn.rows.length === 1, `found ${fn.rows.length}`);
  if (fn.rows.length === 1) {
    const f = fn.rows[0];
    check('it takes no arguments, so there is nothing to smuggle through it', f.pronargs === 0, `pronargs=${f.pronargs}`);
    check('it runs as the definer, because the caller cannot write public.users', f.prosecdef === true);
    check('its search_path is pinned', /search_path=public/.test(f.config ?? ''), String(f.config));
  }

  const acl = await db.query(
    `SELECT has_function_privilege('anon', p.oid, 'EXECUTE')           AS anon_ok,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_ok
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = $1`,
    [rpc],
  );
  check('a signed-in staff member may call it', acl.rows[0]?.auth_ok === true);
  check(
    'anon may NOT call it',
    acl.rows[0]?.anon_ok === false,
    'a function whose only job is to write a row has no business being callable by a role that cannot sign in',
  );

  // --- the journey ---------------------------------------------------------
  await db.query(
    `INSERT INTO users (id, name, email, role, department, avatar, pin, must_change_password)
     VALUES ($1, 'Forced Check', $2, 'PHYSICIAN', 'Records', 'M', '4242', true)`,
    [PROFILE, EMAIL],
  );
  const created = await fetch(`${BASE}/auth/v1/admin/users`, {
    method: 'POST', headers: ADMIN,
    body: JSON.stringify({ email: EMAIL, password: ISSUED, email_confirm: true }),
  }).then((r) => r.json());
  if (!created?.id) throw new Error(`could not create the sign-in account: ${JSON.stringify(created)}`);
  authId = created.id;
  await db.query('UPDATE users SET auth_user_id = $1 WHERE id = $2', [authId, PROFILE]);

  check(
    'an administrator-issued account starts with the flag set',
    (await row())?.must_change_password === true,
  );

  // The user signs in with the password the administrator issued.
  const client = createClient(BASE, ANON, { auth: { persistSession: false } });
  const signedIn = await client.auth.signInWithPassword({ email: EMAIL, password: ISSUED });
  check('the person can sign in with the issued password', !signedIn.error, signedIn.error?.message);

  // Nothing about a clinician's own row may be writable. This is the condition
  // that made the function necessary, so it is asserted rather than assumed: if
  // a future policy change makes this succeed, the reason for the function is
  // gone and this check should be revisited rather than quietly passing.
  const direct = await client.from('users').update({ must_change_password: false }).eq('id', PROFILE).select();
  check(
    'a clinician still cannot clear the flag by updating the table',
    direct.error !== null || (direct.data?.length ?? 0) === 0,
    'if this now succeeds the UPDATE policy has changed and app_clear_own_must_change_password should be reconsidered',
  );
  check('and the flag is genuinely untouched by that attempt', (await row())?.must_change_password === true);

  // The path the app actually takes.
  const cleared = await client.rpc(rpc);
  check('the clinician can clear their own flag', cleared.error === null && cleared.data === true, cleared.error?.message ?? `data=${cleared.data}`);
  check('and the database records it', (await row())?.must_change_password === false);

  const others = await allRows();
  check(
    'no other profile was touched',
    JSON.stringify(others) === JSON.stringify(before),
    'the function must not be able to reach another person',
  );

  const again = await client.rpc(rpc);
  check('calling it twice is harmless', again.error === null && again.data === true);

  // --- what it must not be able to do -------------------------------------
  const withArg = await client.rpc(rpc, { p: 'x' });
  check('it refuses an argument', withArg.error !== null, 'an RPC that took a parameter would be a parameter to smuggle');

  const promote = await client.from('users').update({ role: 'ADMINISTRATOR' }).eq('id', PROFILE).select();
  check(
    'and no amount of calling it grants a role',
    promote.error !== null || (promote.data?.length ?? 0) === 0,
  );
  const target = (await allRows())[0]?.email;
  if (target) {
    const other = await db.query('SELECT must_change_password FROM users WHERE email = $1', [target]);
    const touched = await client.rpc(rpc);
    const after = await db.query('SELECT must_change_password FROM users WHERE email = $1', [target]);
    check(
      'nor can it reach a colleague chosen by the caller',
      JSON.stringify(other.rows) === JSON.stringify(after.rows),
      `called with another profile present, touched=${touched.error?.message ?? touched.data}`,
    );
  }

  const anon = createClient(BASE, ANON, { auth: { persistSession: false } });
  const asAnon = await anon.rpc(rpc);
  check('anon cannot call it', asAnon.error !== null, `it returned ${String(asAnon.data)}`);

  // --- the second attempt, which is what the user actually hit ------------
  // Re-issue the flag and change the password to the one already in force. This
  // is the trap: the flag is still set, the screen is still up, and GoTrue
  // refuses an unchanged password. It used to be reported as "Contact
  // Administration", which is both untrue and useless.
  await db.query('UPDATE users SET must_change_password = true WHERE id = $1', [PROFILE]);
  const reuse = await client.auth.updateUser({ password: CHOSEN });
  check('the user can choose their own password', reuse.error === null, reuse.error?.message);
  const reuseSame = await client.auth.updateUser({ password: CHOSEN });
  check(
    'repeating that same password is refused by Supabase',
    reuseSame.error !== null,
    'if this succeeds there is no trap to detect and the message below proves nothing',
  );
  check(
    'and Supabase says why, in a form the app can recognise',
    /should be different from the old password/i.test(reuseSame.error?.message ?? ''),
    `message=${JSON.stringify(reuseSame.error?.message ?? '')}`,
  );
  // auth.ts maps that onto a sentence of its own; assert the mapping exists,
  // because the message is the only thing the user has to go on.
  const src = readFileSync(new URL('../src/services/auth.ts', import.meta.url), 'utf8');
  check(
    'the app reports it as "you already have that password"',
    /should be different from the old password/i.test(src) && /already have/.test(src),
    'auth.ts must map this refusal to its own sentence rather than falling through to "Contact Administration"',
  );
  check(
    'and does not send the user to an administrator for it',
    !/Contact Administration/.test(src.split('const REJECTIONS')[1]?.split('];')[0] ?? ''),
  );

  // The flag the user can clear for themselves, through the only route.
  const final = await client.rpc(rpc);
  check('and the flag clears again, so the screen can open', final.data === true);
  check('leaving the profile clear', (await row())?.must_change_password === false);
} catch (err) {
  console.error('\nprobe failed:', err.message);
  failures++;
} finally {
  if (authId) {
    await fetch(`${BASE}/auth/v1/admin/users/${authId}`, { method: 'DELETE', headers: ADMIN });
    // A 200 is not proof, and this is the script that matters most for it: the
    // probe signs in, is given a real role, and drives the forced-password-change
    // flow end to end. An account that outlives the run is a working credential
    // for a fake clinician, left on a system holding patient records. So the
    // delete is confirmed against a fresh listing rather than trusted.
    //
    // Guarded, because this runs in a `finally`: an unguarded throw here would
    // replace whatever failure it was cleaning up after, and hide the reason the
    // run failed behind a network error about the cleanup.
    try {
      const stillThere = (
        (await (await fetch(`${BASE}/auth/v1/admin/users?page=1&per_page=200`, { headers: ADMIN })).json()).users ?? []
      ).some((u) => u.email === EMAIL);
      if (stillThere) {
        failures++;
        console.log(`\ncleanup: WARNING the probe account ${EMAIL} SURVIVED deletion and must be removed by hand`);
      } else {
        console.log('\ncleanup: the probe auth account is gone, confirmed by listing');
      }
    } catch (err) {
      failures++;
      console.log(`\ncleanup: WARNING could not confirm the probe account is gone (${err.message}); remove ${EMAIL} by hand`);
    }
  }
  await db.query('DELETE FROM users WHERE id = $1', [PROFILE]).catch(() => {});
  const left = await db.query('SELECT count(*)::int AS n FROM users WHERE id = $1', [PROFILE]);
  console.log(`\ncleanup: the throwaway profile is gone = ${left.rows[0].n === 0}`);
  await db.end();
}

console.log(
  failures === 0
    ? '\nAn administrator can issue a password and the person who was issued it can replace it themselves.'
    : `\n${failures} check(s) failed.`,
);
if (failures > 0) process.exitCode = 1;
