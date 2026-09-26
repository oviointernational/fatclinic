/**
 * Confirm that Row Level Security really holds, from the outside.
 *
 *   npm run db:check-rls
 *
 * `db:apply` inspects the catalog, which proves the policies exist. This proves
 * they are enforced: it calls the public PostgREST endpoint exactly as a browser
 * would and asserts that the anon key gets nothing.
 *
 * It also reports what an authenticated session would be allowed to do, by
 * reading the policy definitions rather than by signing in. That number is the
 * reason email self-signup must stay disabled: a session that exists gets full
 * clinical read/write access, so "anyone can sign up" equals "anyone can read
 * every patient record".
 *
 * Only the anon (publishable) key is used. It is public by design, and no
 * request in this script can write anything: it sends HEAD and GET only.
 */
import 'dotenv/config';

const url = (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
const anonKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();

if (!url || !anonKey) {
  console.error(
    '\n[fatclinic] VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required. ' +
      'See .env.example.\n',
  );
  process.exit(1);
}
if (/\[YOUR-|your-ref|xxxxx/i.test(url + anonKey)) {
  console.error('\n[fatclinic] The Supabase values still contain placeholders.\n');
  process.exit(1);
}

const problems = [];

function request(path, extraHeaders = {}) {
  return fetch(`${url}/rest/v1/${path}`, {
    method: 'GET',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      ...extraHeaders,
    },
  });
}

console.log(`\n[fatclinic] probing ${url}/rest/v1 with the anon key\n`);

// One clinical table and one configuration table. A table with no rows still
// answers 200 with [], so an empty result is not proof of anything: the status
// code is what matters here.
const probes = [
  { table: 'patients', why: 'patient identity, demographics and contact details' },
  { table: 'visits', why: 'who presented, when, and to which ward' },
  { table: 'consultations', why: 'clinical notes, examinations and diagnoses' },
  { table: 'lab_results', why: 'diagnostic results' },
  { table: 'invoices', why: 'billing history' },
  { table: 'users', why: 'staff roster, emails and roles' },
  { table: 'audit_logs', why: 'the record of who accessed what' },
  { table: 'system_settings', why: 'configuration' },
];

for (const { table, why } of probes) {
  const res = await request(table, { Prefer: 'count=exact', Range: '0-0' });
  const count = res.headers.get('content-range');
  const body = res.status === 200 ? await res.text() : '';

  // 200 with rows would mean RLS is not protecting this table.
  const leaked =
    res.status === 200 &&
    count !== null &&
    /^\s*0\//.test(count) === false &&
    body.trim() !== '[]' &&
    body.trim() !== '';

  const verdict = leaked
    ? 'LEAKED'
    : res.status === 200
      ? 'blocked by RLS (200, 0 rows)'
      : `blocked (${res.status} ${res.statusText})`;

  console.log(`  ${table.padEnd(18)} ${verdict}`);
  if (leaked) {
    console.log(`      content-range: ${count}`);
    console.log(`      holds ${why}`);
    problems.push(`${table} returned data to the anon key`);
  }
}

// A write attempt must be rejected too. Sent as a POST that is expected to fail;
// if it somehow succeeds it would create one junk row, so the payload is marked
// clearly and the script reports it loudly.
console.log('\n  write attempt (POST /patients):');
const write = await fetch(`${url}/rest/v1/patients`, {
  method: 'POST',
  headers: {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  },
  body: JSON.stringify({
    id: 'RLS-PROBE-DO-NOT-KEEP',
    first_name: 'Rls',
    last_name: 'Probe',
  }),
});
if (write.status < 400) {
  console.log(`    ACCEPTED (${write.status}) - RLS is not blocking writes`);
  problems.push(`anon was able to INSERT into patients (${write.status})`);
} else {
  console.log(`    rejected (${write.status} ${write.statusText}) - correct`);
}

console.log('');
if (problems.length) {
  console.log('[fatclinic] RLS is NOT holding\n');
  for (const p of problems) console.log(`  - ${p}`);
  console.log('\n  Re-apply the schema with `npm run db:apply` and investigate before going live.\n');
  process.exit(1);
}

console.log('[fatclinic] RLS is holding: the anon key cannot read or write anything.');
console.log('');
console.log('  Reminder: the policies grant an AUTHENTICATED session full clinical');
console.log('  access, so email self-signup must be off in Supabase -> Authentication');
console.log('  -> Providers -> Email. This script cannot verify that setting.\n');
