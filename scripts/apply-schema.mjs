/**
 * Apply the FatClinic schema to Postgres, then verify it.
 *
 *   npm run db:apply
 *
 * database/fatclinic.sql is the single source of truth: tables, indexes,
 * triggers, Row Level Security, views and seed data. It is idempotent, so
 * re-running is safe. The whole file runs inside one transaction and is rolled
 * back on any error, so a failure never leaves a half-applied schema.
 *
 * Connection details come from PGHOST/PGPASSWORD or DATABASE_URL. See
 * .env.example, and scripts/db-config.mjs for why the separate form is
 * preferred.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { resolveConnection, shouldUseSsl, connectWithRetry, resolveHost } from './db-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SCHEMA = 'fatclinic.sql';

function fail(message) {
  console.error(`\n[fatclinic] ${message}\n`);
  process.exit(1);
}

let connection;
try {
  connection = resolveConnection(process.env);
} catch (err) {
  fail(err.message);
}

const useSsl = shouldUseSsl(connection.options, process.env);
console.log(`[fatclinic] target : ${connection.label}  (via ${connection.source})`);
console.log(`[fatclinic] ssl    : ${useSsl ? 'on' : 'off'}`);

// A fresh Client per attempt: node-postgres refuses to reconnect one that has
// already been used, even if the first connect failed. The host is re-resolved
// each time, because a pinned address can be the thing that went stale.
let pinnedNote = false;
const makeClient = async () => {
  const target = await resolveHost(connection.options.host);
  if (target.pinned && !pinnedNote) {
    pinnedNote = true;
    console.log(`[fatclinic] note    : ${target.reason}`);
  }
  return new pg.Client({
    ...connection.options,
    host: target.host,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    // Without this a dead route hangs indefinitely instead of failing.
    connectionTimeoutMillis: 20_000,
  });
};

let client;
try {
  client = await connectWithRetry(makeClient);
} catch (err) {
  // Scrub anything password-shaped before it reaches the console.
  const secret = connection.options.password || '';
  const message = secret ? err.message.split(secret).join('***') : err.message;

  // Point at the actual cause. A single generic hint sends people off to reset
  // a password that was fine, which is how a working setup gets broken.
  let hint;
  if (/password authentication failed|no pg_hba\.conf entry|role .* does not exist/i.test(message)) {
    hint =
      'The server rejected the credentials. Either the password is wrong, or the ' +
      'database has been reset. Supabase -> Project Settings -> Database -> Reset ' +
      'database password, then update PGPASSWORD in .env.';
  } else if (/ENOTFOUND|getaddrinfo|ENOENT/i.test(message)) {
    // A well-formed Supabase host that fails to resolve is a local DNS problem,
    // not a URL problem. Only a hostname that does not look right suggests the
    // password was truncated inside a URI.
    const hostLooksRight = /^db\.[a-z0-9]+\.supabase\.co$/i.test(connection.options.host || '');
    hint = hostLooksRight
      ? 'The hostname is well formed but did not resolve, so this is a local DNS ' +
        'problem rather than a configuration error. Check your connection, VPN, ' +
        'or DNS resolver, then retry.'
      : 'The hostname did not resolve. If the password contains @ or #, a ' +
        'postgresql:// URL is truncated at that point and resolves to a nonsense ' +
        'host - use the separate PGHOST / PGPASSWORD form instead.';
  } else if (/ENETUNREACH|EHOSTUNREACH|EADDRNOTAVAIL/i.test(message)) {
    hint =
      'The address resolved but the network has no route to it. Supabase ' +
      'database hosts are often IPv6-only, so this machine either lacks IPv6 ' +
      'connectivity or cannot route it. Options: restore IPv6, or use the IPv4 ' +
      'connection pooler from Project Settings -> Database -> Connection string ' +
      '(the "Session pooler" row), which serves IPv4. See .env.example.';
  } else if (/ETIMEDOUT|ECONNREFUSED/i.test(message)) {
    hint =
      'The connection timed out. This is usually a transient network or VPN issue ' +
      'rather than a credentials problem. Retry; if it persists, check that port ' +
      '5432 is reachable and that your firewall allows it.';
  } else if (/certificate|self.signed|unable to verify/i.test(message)) {
    hint = 'TLS failed. Set PG_SSL=false only if you are certain the host does not require TLS.';
  } else {
    hint = 'See the error above.';
  }

  fail(`Could not connect to ${connection.label}: ${message}\n\n  ${hint}`);
}

const { rows: target } = await client.query(
  'SELECT current_database() AS db, current_user AS usr, current_setting(\'server_version\') AS ver',
);
console.log(
  `[fatclinic] server : ${target[0].ver}  as ${target[0].usr} on ${target[0].db}\n`,
);

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

const sql = fs.readFileSync(path.join(ROOT, 'database', SCHEMA), 'utf8');

try {
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log(`[fatclinic] applied database/${SCHEMA}\n`);
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`\n[fatclinic] apply failed and was rolled back: ${err.message}\n`);
  if (err.position) {
    const pos = Number(err.position);
    const line = sql.slice(0, pos).split('\n').length;
    console.error(`[fatclinic] near line ${line} of database/${SCHEMA}`);
    console.error(
      sql
        .split('\n')
        .slice(Math.max(0, line - 3), line + 2)
        .map((l, i) => `  ${Math.max(1, line - 2) + i} | ${l}`)
        .join('\n') + '\n',
    );
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

console.log('[fatclinic] verification\n');

const problems = [];
const { rows: onSupabase } = await client.query(
  `SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') AS present`,
);
const isSupabase = onSupabase[0].present;

const { rows: tableRows } = await client.query(`
  SELECT c.relname AS table,
         c.relrowsecurity AS rls_enabled,
         c.relforcerowsecurity AS rls_forced,
         (SELECT count(*)::int FROM pg_policies p
           WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies,
         (SELECT count(*)::int FROM pg_index i
           WHERE i.indrelid = c.oid) AS indexes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
   ORDER BY c.relname
`);

if (!tableRows.length) {
  problems.push('no tables were created');
}

const { rows: viewRows } = await client.query(`
  SELECT count(*)::int AS n FROM pg_views WHERE schemaname = 'public'
`);

console.log(`  tables            : ${tableRows.length}`);
console.log(`  views             : ${viewRows[0].n}`);
console.log(`  indexes           : ${tableRows.reduce((n, t) => n + t.indexes, 0)}`);

if (isSupabase) {
  const unprotected = tableRows.filter((t) => !t.rls_enabled || t.policies === 0);
  const unforced = tableRows.filter((t) => t.rls_enabled && !t.rls_forced);

  console.log(`  RLS enabled       : ${tableRows.length - unprotected.length}/${tableRows.length}`);
  console.log(`  RLS forced        : ${tableRows.length - unforced.length}/${tableRows.length}`);
  console.log(`  total policies    : ${tableRows.reduce((n, t) => n + t.policies, 0)}`);

  for (const t of unprotected) {
    console.log(`    UNPROTECTED: ${t.table} (rls=${t.rls_enabled}, policies=${t.policies})`);
  }
  if (unprotected.length) problems.push(`${unprotected.length} table(s) without RLS policies`);
  if (unforced.length) problems.push(`${unforced.length} table(s) with RLS not FORCED`);

  const { rows: grants } = await client.query(`
    SELECT table_name, privilege_type
      FROM information_schema.role_table_grants
     WHERE grantee = 'anon' AND table_schema = 'public'
     ORDER BY table_name
  `);
  console.log(`  anon table grants : ${grants.length === 0 ? 'none (correct)' : grants.length}`);
  for (const g of grants) console.log(`    - ${g.table_name}: ${g.privilege_type}`);
  if (grants.length) problems.push(`anon still holds ${grants.length} table grant(s)`);

  const { rows: auditPolicies } = await client.query(`
    SELECT policyname, cmd FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'audit_logs' ORDER BY policyname
  `);
  const auditMutations = auditPolicies.filter((p) => ['UPDATE', 'DELETE', 'ALL'].includes(p.cmd));
  console.log(
    `  audit_logs policy : ${auditPolicies.map((p) => `${p.policyname}(${p.cmd})`).join(', ') || 'NONE'}`,
  );
  if (!auditPolicies.length) problems.push('audit_logs has no policies at all');
  if (auditMutations.length) problems.push(`audit_logs is mutable: ${auditMutations.map((p) => p.cmd).join(', ')}`);
} else {
  console.log('  RLS               : SKIPPED (no auth schema). This database must not be exposed.');
  problems.push('no auth schema: Row Level Security was not applied');
}

// The audit immutability trigger must be present and must actually fire.
const { rows: auditTrigger } = await client.query(`
  SELECT count(*)::int AS n FROM pg_trigger
   WHERE tgname = 'trg_audit_immutable' AND NOT tgisinternal
`);
if (!auditTrigger[0].n) problems.push('audit immutability trigger is missing');

// Invoice arithmetic is the other piece of real logic, so exercise it. The
// probe runs in a transaction that is always rolled back, so a verification run
// cannot leave test rows in a clinical database even if it fails midway.
const mathResults = await client.query(`
  BEGIN;
  DO $$
  DECLARE
    v_probe TEXT := 'VERIFY-PROBE-' || substr(md5(random()::text), 1, 8);
  BEGIN
    INSERT INTO patients (id, first_name, last_name, dob, age, sex, phone)
    VALUES (v_probe, 'Schema', 'Probe', CURRENT_DATE, 30, 'Male', '000');
    INSERT INTO visits (id, patient_id, visit_date, visit_type, status)
    VALUES ('VIS-' || v_probe, v_probe, CURRENT_DATE, 'Routine', 'Completed');
    INSERT INTO invoices (id, visit_id, patient_id) VALUES (v_probe, 'VIS-' || v_probe, v_probe);

    -- Line items but no payments. This is the case the old trigger skipped: it
    -- tested IF NOT FOUND after the payments SELECT, and FOUND is false for a
    -- query that matched no rows, so subtotal and total stayed at zero.
    INSERT INTO invoice_items (id, invoice_id, service_category, description, quantity, unit_price, total_price)
    VALUES ('II-' || v_probe, v_probe, 'Consultation', 'Probe', 2, 500, 1000);
  END $$;

  -- A discount edit with no child-row change, which the old schema never
  -- recalculated: the trigger only fired from invoice_items and payments.
  UPDATE invoices SET discount = 200 WHERE id LIKE 'VERIFY-PROBE-%';

  -- Part-payment then moves the status along.
  INSERT INTO payments (id, invoice_id, receipt_number, amount, payment_method)
  SELECT 'PM-' || id, id, 'RCPT-' || id, 400, 'Cash' FROM invoices WHERE id LIKE 'VERIFY-PROBE-%';

  SELECT subtotal, discount, total, paid_amount, balance, payment_status
    FROM invoices WHERE id LIKE 'VERIFY-PROBE-%';
`);

// node-postgres returns one Result per statement in a multi-statement query;
// the SELECT is the last one. Taking rows from the DO block's Result is why an
// earlier version of this check saw no rows at all.
const probeRows = mathResults[mathResults.length - 1].rows;
await client.query('ROLLBACK').catch(() => {});

if (!probeRows.length) {
  problems.push('invoice probe produced no rows');
} else {
  const p = probeRows[0];
  if (Number(p.subtotal) !== 1000) problems.push(`invoice subtotal should be 1000, got ${p.subtotal}`);
  if (Number(p.total) !== 800) problems.push(`invoice total should be 800 after a 200 discount, got ${p.total}`);
  if (Number(p.balance) !== 400) problems.push(`invoice balance should be 400, got ${p.balance}`);
  if (p.payment_status !== 'Partially Paid') {
    problems.push(`invoice status should be Partially Paid, got ${p.payment_status}`);
  }
  console.log(
    `  invoice math       : subtotal ${p.subtotal}, discount ${p.discount}, total ${p.total}, ` +
      `paid ${p.paid_amount}, balance ${p.balance}, status ${p.payment_status}`,
  );
}

// updated_at should be maintained by trigger on every table that has one.
const { rows: stale } = await client.query(`
  SELECT c.relname AS table
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = c.oid AND a.attname = 'updated_at' AND a.attnum > 0)
     AND NOT EXISTS (SELECT 1 FROM pg_trigger tg
                      WHERE tg.tgrelid = c.oid AND tg.tgname = 'trg_touch_updated_at')
   ORDER BY c.relname
`);
if (stale.length) {
  for (const s of stale) console.log(`    no updated_at trigger: ${s.table}`);
  problems.push(`${stale.length} table(s) missing the updated_at trigger`);
}

const { rows: counts } = await client.query(`
  SELECT
    (SELECT count(*)::int FROM wards)            AS wards,
    (SELECT count(*)::int FROM users)            AS users,
    (SELECT count(*)::int FROM permission_nodes) AS permission_nodes,
    (SELECT count(*)::int FROM role_permissions) AS role_permissions,
    (SELECT count(*)::int FROM system_settings)  AS settings
`);
const c = counts[0];
console.log(
  `\n  seed: ${c.wards} wards, ${c.users} staff, ${c.permission_nodes} permission nodes, ` +
    `${c.role_permissions} role grants, system_settings id=${c.settings}`,
);
if (c.settings !== 1) problems.push('system_settings seed missing');
if (c.wards === 0) problems.push('wards seed missing');
if (c.users === 0) problems.push('staff seed missing');
if (c.permission_nodes === 0) problems.push('permission_nodes seed missing');

// No plaintext credentials may exist in the schema.
const { rows: pwCols } = await client.query(`
  SELECT c.relname AS table, a.attname AS column
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND a.attname IN ('password', 'password_hash', 'pin_hash')
     AND a.attnum > 0 AND NOT a.attisdropped
`);
if (pwCols.length) {
  for (const p of pwCols) console.log(`    credential column: ${p.table}.${p.column}`);
  problems.push(`credential column(s) present: ${pwCols.map((p) => `${p.table}.${p.column}`).join(', ')}`);
}

await client.end();

if (problems.length) {
  console.log(`\n[fatclinic] PROBLEMS\n`);
  for (const p of problems) console.log(`  - ${p}`);
  console.log('');
  process.exit(1);
}

console.log('\n[fatclinic] schema verified.\n');
if (isSupabase) {
  console.log('  Next: turn OFF "Enable email signup" in Supabase -> Authentication');
  console.log('        -> Providers -> Email. Until you do, anyone can sign up and');
  console.log('        read every patient record, because the policies grant full');
  console.log('        clinical access to any authenticated session.');
  console.log('        Then create an Auth account for each of the seeded staff emails.\n');
} else {
  console.log('  WARNING: Row Level Security was not applied. Do not expose this database.\n');
}
