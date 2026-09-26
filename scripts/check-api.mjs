// Verify the live PostgREST API against database/fatclinic.sql, over IPv4.
//
// This exists because the direct Postgres host is IPv6-only. `db:apply` needs a
// Postgres connection and cannot run on a machine with no IPv6 route, but the
// REST API is reachable over IPv4, and PostgREST will answer a question the SQL
// file cannot: are these tables actually live in the running database, and are
// they in the schema cache?
//
// The distinction matters. A table that was created but never picked up by the
// schema cache returns PGRST205, and the app's first query against it fails at
// runtime with an error no amount of schema re-reading explains. Re-running
// `db:apply` is the usual way to catch that; this is the way to catch it when the
// connection is unavailable.
//
// The 404/401 split is what makes the check meaningful, and it is verified with a
// control probe rather than assumed:
//
//   404 PGRST205  the name is not in the schema cache  -> the table is missing
//   401 42501     the name IS in the cache, and the anon role has no grant
//   200           reachable with the anon key          -> an RLS hole
//
// A 401 alone would prove nothing if a missing table also returned 401, so the
// control name must come back 404 for any of the 401s to mean "present".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A read-only probe except for the single deliberate write attempt at the end,
// which exists to prove writes are blocked too. Only the anon (publishable) key
// is used; it is public by design and cannot read anything here.
import 'dotenv/config';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = fs.readFileSync(path.join(ROOT, 'database', 'fatclinic.sql'), 'utf8');

const url = (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
const key = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();

if (!url || !key) {
  console.error('[fatclinic] VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required.');
  console.error('           They are the project URL and the anon key - not the database password.');
  process.exit(1);
}

/**
 * Drop dollar-quoted blocks and `--` comments, so the DDL search cannot pick up
 * a phrase from a PL/pgSQL error message or a design note. The schema file
 * contains both: it explains the half-applied-schema guard in prose, and the
 * guard's own RAISE message quotes the very statement being searched for.
 */
function ddlOnly(text) {
  let out = text.replace(/\$\$[\s\S]*?\$\$/g, ' ');
  let result = '';
  let inString = false;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    if (inString) {
      result += ch;
      if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") {
      inString = true;
      result += ch;
      continue;
    }
    if (ch === '-' && out[i + 1] === '-') {
      while (i < out.length && out[i] !== '\n') i++;
      result += '\n';
      continue;
    }
    result += ch;
  }
  return result;
}

const ddl = ddlOnly(sql);
const NAMES = [
  ...[...ddl.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g)].map((m) => m[1]),
  ...[...ddl.matchAll(/CREATE OR REPLACE VIEW\s+(\w+)/g)].map((m) => m[1]),
];

const dupes = NAMES.filter((n, i) => NAMES.indexOf(n) !== i);
if (dupes.length) {
  console.error(`[fatclinic] the schema file declares a name twice: ${[...new Set(dupes)].join(', ')}`);
  process.exit(1);
}

async function probe(name, method = 'GET', body = null) {
  const response = await fetch(`${url}/rest/v1/${name}?select=*&limit=1`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let code = '';
  try {
    code = JSON.parse(text).code ?? '';
  } catch {
    code = '';
  }
  return { status: response.status, code };
}

const MISSING = 'PGRST205';
const NO_PRIVILEGE = '42501';

console.log(`[fatclinic] probing ${url}/rest/v1 with the anon key`);
console.log(`[fatclinic] ${NAMES.length} names declared in database/fatclinic.sql`);
console.log('');

// The control. Without this, "everything returned 401" is equally consistent
// with "the API rejected every request" and with "the tables are all there".
const control = await probe('fatclinic_control_name_that_does_not_exist');
const controlOk = control.status === 404 && control.code === MISSING;
console.log(
  `  control probe: a name that does not exist -> ${control.status} ${control.code || '(no code)'}`,
);
if (!controlOk) {
  console.log('');
  console.log('  The control did not come back 404 PGRST205, so a 401 on a real table');
  console.log('  would not prove anything. Refusing to report the rest as passing.');
  process.exitCode = 1;
} else {
  console.log('  (so a 401 below really does mean the table is present)');
}
console.log('');

const missing = [];
const readable = [];
const other = [];

for (const name of NAMES) {
  const r = await probe(name);
  if (r.status === 404 && r.code === MISSING) missing.push(name);
  else if (r.status === 200) readable.push(name);
  else if (r.status === 401 || r.status === 403) {
    if (r.code !== NO_PRIVILEGE) other.push(`${name} (${r.status} ${r.code})`);
  } else other.push(`${name} (${r.status} ${r.code})`);
}

const width = Math.max(...NAMES.map((n) => n.length));
for (const name of NAMES) {
  if (missing.includes(name)) console.log(`  ${name.padEnd(width)}  MISSING from the schema cache`);
}

console.log('');
if (missing.length) {
  console.log(`  ${missing.length} of ${NAMES.length} are in the SQL file but not in the running database:`);
  console.log(`    ${missing.join(', ')}`);
  console.log('    Re-run `npm run db:apply` and then REFRESH the PostgREST schema');
  console.log('    (Notifications -> Database -> Reload schema) to clear the cache.');
}
if (readable.length) {
  console.log(`  ${readable.length} are readable with the ANON key, which is an RLS hole:`);
  console.log(`    ${readable.join(', ')}`);
  console.log('    Nothing in a clinical database should be reachable without a session.');
}
if (other.length) {
  console.log(`  ${other.length} answered with something other than a clean block:`);
  console.log(`    ${other.join(', ')}`);
}

// A write attempt, so a read-only RLS policy set cannot pass this check.
const writeTarget = 'patients';
const w = await probe(writeTarget, 'POST', { id: 'CHECK-RLS-PROBE', first_name: 'x' });
const writeBlocked = w.status === 401 || w.status === 403 || w.status === 409;
console.log('');
console.log(`  write attempt (POST /${writeTarget}): ${w.status} - ${writeBlocked ? 'rejected, correct' : 'NOT REJECTED'}`);

console.log('');
const ok = controlOk && !missing.length && !readable.length && !other.length && writeBlocked;
if (ok) {
  console.log(
    `[fatclinic] all ${NAMES.length} tables and views are live and in the schema cache, and the anon key can reach none of them.`,
  );
} else {
  process.exitCode = 1;
  console.log('[fatclinic] the live API does not match database/fatclinic.sql - see above.');
}
