/**
 * Apply the FatClinic schema and Row Level Security to Postgres, then verify.
 *
 *   npm run db:apply
 *
 * Reads DATABASE_URL from .env (see .env.example). Refuses to run against a
 * placeholder URL, because a half-applied schema on a real project is worse than
 * no schema at all.
 *
 * Order matters: fatclinic.sql creates the tables, rls.sql then locks them down.
 * Both files are idempotent, so re-running is safe.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const PLACEHOLDER = /\[YOUR-|YOUR-PASSWORD|your-ref|changeme/i;

function fail(message) {
  console.error(`\n[fatclinic] ${message}\n`);
  process.exit(1);
}

const connectionString = (process.env.DATABASE_URL || '').trim();
if (!connectionString) {
  fail('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
}
if (PLACEHOLDER.test(connectionString)) {
  fail('DATABASE_URL still contains a placeholder. Paste the real connection string into .env.');
}

const isPrivateHost = /localhost|127\.0\.0\.1|\.internal/.test(connectionString);
const sslEnv = String(process.env.PG_SSL || '').toLowerCase();
const useSsl = sslEnv === 'true' || (sslEnv !== 'false' && !isPrivateHost);

// The database name is safe to show; the password never is.
const safeTarget = connectionString.replace(/\/\/([^:]+):[^@]*@/, '//$1:***@');
console.log(`[fatclinic] target: ${safeTarget}`);
console.log(`[fatclinic] ssl: ${useSsl ? 'on' : 'off'}`);

const client = new pg.Client({ connectionString, ssl: useSsl ? { rejectUnauthorized: false } : undefined });

try {
  await client.connect();
} catch (err) {
  fail(`Could not connect: ${err.message}`);
}

async function apply(file) {
  const sql = fs.readFileSync(path.join(ROOT, 'database', file), 'utf8');
  const label = path.join('database', file);
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log(`[fatclinic] applied ${label}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(`Failed applying ${label}: ${err.message}`);
  }
}

await apply('fatclinic.sql');
await apply('rls.sql');

// ---- verification ---------------------------------------------------------

console.log('\n[fatclinic] verification\n');

const { rows: tableRows } = await client.query(`
  SELECT c.relname AS table,
         c.relrowsecurity AS rls_enabled,
         c.relforcerowsecurity AS rls_forced,
         (SELECT count(*)::int FROM pg_policies p
           WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
   ORDER BY c.relname
`);

if (!tableRows.length) {
  fail('No tables found in the public schema after applying fatclinic.sql.');
}

const unprotected = tableRows.filter((t) => !t.rls_enabled || t.policies === 0);
console.log(`  tables:            ${tableRows.length}`);
console.log(`  RLS enabled:       ${tableRows.length - unprotected.length}/${tableRows.length}`);
console.log(`  RLS forced:        ${tableRows.filter((t) => t.rls_forced).length}/${tableRows.length}`);
console.log(`  total policies:    ${tableRows.reduce((n, t) => n + t.policies, 0)}`);

if (unprotected.length) {
  console.log('\n  UNPROTECTED (readable/writable by any table grant):');
  for (const t of unprotected) {
    console.log(`    - ${t.table} (rls=${t.rls_enabled}, policies=${t.policies})`);
  }
}

// The anon role must hold no privileges at all.
const { rows: grants } = await client.query(`
  SELECT table_name, privilege_type
    FROM information_schema.role_table_grants
   WHERE grantee = 'anon' AND table_schema = 'public'
   ORDER BY table_name
`);
console.log(`\n  anon table grants: ${grants.length === 0 ? 'none (correct)' : grants.length}`);
for (const g of grants) console.log(`    - ${g.table_name}: ${g.privilege_type}`);

// audit_logs must have no UPDATE/DELETE policy.
const { rows: auditPolicies } = await client.query(`
  SELECT policyname, cmd FROM pg_policies
   WHERE schaname = 'public' AND tablename = 'audit_logs' ORDER BY policyname
`);
const auditMutations = auditPolicies.filter((p) => ['UPDATE', 'DELETE', 'ALL'].includes(p.cmd));
console.log(`  audit_logs policies: ${auditPolicies.map((p) => `${p.policyname}(${p.cmd})`).join(', ') || 'none'}`);
if (auditMutations.length) {
  fail(`audit_logs has mutating policies: ${auditMutations.map((p) => p.cmd).join(', ')}`);
}

// Seeded reference data sanity check.
const { rows: counts } = await client.query(`
  SELECT
    (SELECT count(*)::int FROM wards)             AS wards,
    (SELECT count(*)::int FROM users)             AS users,
    (SELECT count(*)::int FROM permission_nodes)  AS permission_nodes,
    (SELECT count(*)::int FROM system_settings)   AS system_settings
`);
const c = counts[0];
console.log(`\n  seed: ${c.wards} wards, ${c.users} staff, ${c.permission_nodes} permission nodes, system_settings id=${c.system_settings}`);

const problems = [];
if (unprotected.length) problems.push(`${unprotected.length} table(s) without RLS policies`);
if (grants.length) problems.push(`anon still holds ${grants.length} table grant(s)`);
if (auditMutations.length) problems.push('audit_logs is mutable');
if (c.wards === 0) problems.push('wards seed missing');
if (c.users === 0) problems.push('staff seed missing');

await client.end();

if (problems.length) {
  console.log(`\n[fatclinic] PROBLEMS: ${problems.join('; ')}\n`);
  process.exit(1);
}

console.log('\n[fatclinic] schema and RLS verified.\n');
console.log('Next: create Supabase Auth accounts for the staff, then wire the data layer.\n');
