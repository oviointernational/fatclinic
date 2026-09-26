/**
 * Prove that an authenticated session with no staff profile reads nothing.
 *
 *   npm run db:check-orphan
 *
 * `db:check-rls` only tests the anon key, which is the easy half. The half that
 * actually matters is this: Supabase auth accounts and public.users rows are two
 * separate things, and they drift. An admin creates an account in the dashboard
 * before the profile exists; a profile is deleted and the account outlives it; a
 * staff member is deactivated but the token is still valid. Each of those leaves
 * a session that authenticates successfully and matches no staff row.
 *
 * Such a session is not a harmless curiosity. Every policy here is written for
 * `authenticated`, so before app_is_staff() existed those policies were
 * `USING (true)` and the session could read every patient record. The bug was
 * invisible to the anon check, which is exactly why it needed its own test.
 *
 * This creates a throwaway auth account with no public.users row, signs in as it
 * for a genuine JWT, and tries to read and write. It needs the service_role key
 * because no browser can mint an account. The account is always deleted, even on
 * failure, and the script refuses to touch an email that already has a profile.
 */
import 'dotenv/config';

const url = (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
const anonKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!url || !anonKey) {
  console.error('\n[fatclinic] VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required.\n');
  process.exit(1);
}
if (!serviceKey) {
  console.error(
    '\n[fatclinic] SUPABASE_SERVICE_ROLE_KEY is required to create a throwaway account.\n'
      + '  This script never needs it for anything else, and it is not in the bundle.\n',
  );
  process.exit(1);
}

// A domain that cannot receive mail, so a stray signup email is never deliverable.
const EMAIL = `orphan-probe-${Date.now()}@rls-probe.invalid`;
const PASSWORD = `probe-${process.pid}-${Date.now()}`;

const admin = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
const problems = [];

async function authAdmin(path, options = {}) {
  const res = await fetch(`${url}/auth/v1/admin/${path}`, { ...options, headers: { ...admin, ...options.headers } });
  const text = await res.text();
  return { status: res.status, ok: res.ok, text, body: text ? JSON.parse(text) : null };
}

let userId = null;

async function cleanup() {
  if (!userId) return;
  try {
    const r = await authAdmin(`users/${userId}`, { method: 'DELETE' });
    console.log(`\n  cleaned up the throwaway account (${r.status})`);
    userId = null;
  } catch (e) {
    console.error(
      `\n  WARNING: could not delete the probe account ${EMAIL} (${userId}).\n`
        + '  Remove it by hand in Supabase -> Authentication -> Users.\n',
    );
  }
}

console.log(`\n[fatclinic] orphan-account probe against ${url}\n`);

// --- preflight: never touch a real person -------------------------------------
const existing = await fetch(`${url}/rest/v1/users?email=eq.${encodeURIComponent(EMAIL)}&select=id`, {
  headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
});
if (existing.status >= 400) {
  console.error(`  cannot read public.users as service_role (${existing.status}). Stopping.`);
  process.exit(1);
}
if ((await existing.json()).length > 0) {
  console.error(`  a profile already exists for ${EMAIL}. Refusing to continue.`);
  process.exit(1);
}

// --- create the account, with no profile --------------------------------------
const created = await authAdmin('users', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
});
if (!created.ok) {
  console.error(`  could not create the probe account: ${created.status} ${created.text.slice(0, 200)}`);
  process.exit(1);
}
userId = created.body?.id;
console.log(`  created a throwaway auth account with no staff profile: ${EMAIL}`);

// A defensive re-check: if anything ever seeds a matching profile, the rest of
// this script would be testing a real staff member's access instead of an orphan's.
const profile = await fetch(`${url}/rest/v1/users?email=eq.${encodeURIComponent(EMAIL)}&select=id`, {
  headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
});
if ((await profile.json()).length > 0) {
  console.error('  a profile appeared for the probe account. Aborting before testing.');
  await cleanup();
  process.exit(1);
}

// --- sign in for a real JWT ----------------------------------------------------
const signIn = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anonKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!signIn.ok) {
  console.error(`  the probe account could not sign in (${signIn.status}). Cannot test.`);
  await cleanup();
  process.exit(1);
}
const jwt = (await signIn.json()).access_token;
console.log('  signed in successfully - this is a VALID session with no staff profile\n');

// --- it must read nothing ------------------------------------------------------
const tables = [
  'patients', 'visits', 'consultations', 'lab_results', 'invoices',
  'users', 'audit_logs', 'wards', 'system_settings',
];
const asUser = { apikey: anonKey, Authorization: `Bearer ${jwt}` };

console.log('  reads:');
for (const table of tables) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=5`, {
    headers: { ...asUser, Prefer: 'count=exact', Range: '0-4' },
  });
  const count = res.headers.get('content-range');

  // Every 2xx is a success, and the Range header above makes PostgREST answer
  // 206 rather than 200. Testing for `status === 200` alone is how this script
  // reported "holding" while wards was handing out all 10 of its rows: a leak
  // that returns 206 looks like a block. Parse the body for any 2xx.
  const ok = res.status >= 200 && res.status < 300;
  const body = ok ? await res.text() : '';
  const rows = body.trim() === '[]' || body.trim() === '' ? 0 : 1;
  const leaked = ok && rows > 0;

  console.log(`    ${table.padEnd(18)} ${leaked ? `LEAKED (${res.status}, ${count})` : `blocked (${res.status}, ${count ?? 'no rows'})`}`);
  if (leaked) problems.push(`an orphan session read rows from ${table}`);
}

// --- it must write nothing -----------------------------------------------------
console.log('\n  writes:');
for (const [table, payload] of [
  ['patients', { id: 'ORPHAN-PROBE', first_name: 'Orphan', last_name: 'Probe' }],
  ['audit_logs', { id: 'ORPHAN-PROBE', action: 'probe' }],
]) {
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...asUser, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(payload),
  });
  const ok = res.status < 400;
  console.log(`    INSERT ${table.padEnd(14)} ${ok ? 'ACCEPTED - policy is open' : `blocked (${res.status}) - correct`}`);
  if (ok) {
    problems.push(`an orphan session INSERTed into ${table}`);
    // Undo it rather than leave junk in a clinical table.
    await fetch(`${url}/rest/v1/${table}?id=eq.ORPHAN-PROBE`, {
      method: 'DELETE',
      headers: { ...asUser, Prefer: 'return=minimal' },
    });
  }
}

// Nothing should have landed anywhere, whatever the policies said.
const strays = await fetch(`${url}/rest/v1/patients?id=eq.ORPHAN-PROBE&select=id`, {
  headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
});
if (strays.ok && (await strays.json()).length > 0) {
  problems.push('the ORPHAN-PROBE row survived cleanup');
  await fetch(`${url}/rest/v1/patients?id=eq.ORPHAN-PROBE`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  console.log('\n  removed the probe row that reached public.patients');
}

await cleanup();

console.log('');
if (problems.length) {
  console.log('[fatclinic] AN ORPHAN AUTH ACCOUNT HAS ACCESS\n');
  for (const p of problems) console.log(`  - ${p}`);
  console.log(
    '\n  The staff-table policies must be gated on app_is_staff(), not USING (true).\n'
      + '  Re-apply: npm run db:apply\n',
  );
  process.exit(1);
}

console.log('[fatclinic] holding: a valid session with no staff profile reads and writes nothing.');
console.log('');
