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
import { DEMO_STAFF_EMAILS } from './demo-staff.mjs';

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

// Policy names the schema declares, read from the file rather than hard-coded,
// so this comparison cannot drift from the thing it is checking.
//
// Most policies are not written out. They are generated by a DO block that loops
// over `staff_tables` and `admin_tables` and emits `<table>_select/_insert/
// _update/_delete`, so a naive search for "CREATE POLICY <name>" finds only the
// two hand-written audit_logs policies and would then report 132 false
// positives. The arrays are read out of the same file and expanded, which keeps
// the check honest in both directions.
//
// Comment lines are stripped first: the schema documents its policies in prose
// that quotes names like `users_delete`, and a naive match would "find" a policy
// that is only ever mentioned in a comment.
const schemaText = fs.readFileSync(path.join(ROOT, 'database', SCHEMA), 'utf8');
const schemaCode = schemaText
  .split(/\r?\n/)
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

/** The table names in a `name TEXT[] := ARRAY[ ... ]` declaration. */
function tableArray(name) {
  const m = schemaCode.match(new RegExp(`${name}\\s+TEXT\\[\\]\\s*:=\\s*ARRAY\\[([\\s\\S]*?)\\]`, 'i'));
  if (!m) return [];
  return [...m[1].matchAll(/'([a-z0-9_]+)'/gi)].map((x) => x[1]);
}

const declaredPolicies = new Set(
  [...schemaCode.matchAll(/CREATE\s+POLICY\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_]+)/gi)].map((m) => m[1]),
);
for (const table of [...tableArray('staff_tables'), ...tableArray('admin_tables')]) {
  for (const cmd of ['select', 'insert', 'update', 'delete']) {
    declaredPolicies.add(`${table}_${cmd}`);
  }
}

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

  // --- drift: policies the schema does not declare ---------------------------
  //
  // `CREATE POLICY IF NOT EXISTS` means applying the schema can only ever ADD
  // policies, never remove one. So a policy added straight to the database - to
  // unblock a feature, in a hurry - survives every future apply, and the file
  // that is supposed to be the single source of truth quietly stops describing
  // the database. That already happened once: `users_delete` was live for the
  // delete-staff feature and had never been written down, so a rebuild from
  // this file would have lost it with nothing to notice.
  //
  // Comparing the two directions catches it. Extra policies are reported rather
  // than dropped, because silently deleting a policy in a database full of
  // patient records is not a decision a script should make on its own.
  const declared = new Set(declaredPolicies);
  const { rows: livePolicies } = await client.query(`
    SELECT policyname, tablename, cmd FROM pg_policies
     WHERE schemaname = 'public' ORDER BY policyname
  `);
  const undeclared = livePolicies.filter((p) => !declared.has(p.policyname));
  const missing = [...declared].filter((name) => !livePolicies.some((p) => p.policyname === name));
  console.log(`  declared policies: ${declared.size}`);
  console.log(`  live policies     : ${livePolicies.length}`);
  if (undeclared.length) {
    console.log('  UNDECLARED (live but not in database/fatclinic.sql):');
    for (const p of undeclared) console.log(`    - ${p.policyname} on ${p.tablename} (${p.cmd})`);
    problems.push(
      `${undeclared.length} policy(ies) exist in the database but not in the schema: ` +
        undeclared.map((p) => `${p.policyname} on ${p.tablename}`).join(', '),
    );
  }
  if (missing.length) {
    console.log('  MISSING (declared but not live):');
    for (const name of missing) console.log(`    - ${name}`);
    problems.push(`${missing.length} declared policy(ies) are absent from the database: ${missing.join(', ')}`);
  }
  if (!undeclared.length && !missing.length) console.log('  policy drift      : none - schema and database agree');

  // --- drift: functions the schema does not declare --------------------------
  //
  // The same argument as policies, and the same bug: `users_delete` was a live
  // policy nobody had written down. `CREATE OR REPLACE FUNCTION` has the same
  // one-way property - applying the file can change a function it declares and
  // cannot remove one it does not - so a function added straight to the database
  // outlives every future apply and a rebuild from this file silently loses it.
  //
  // There is one already: `app_own_account_id` is live, is called by nothing, and
  // is in no file. Harmless today because nothing depends on it, which is exactly
  // why it is worth naming now rather than the first time something does.
  //
  // Names only, never bodies. `pg_get_functiondef` reformats whitespace and
  // casing, so comparing its output to the file text would report every function
  // as drifted. "The file does not mention this one" is the claim that can
  // actually be made honestly, and it is the one that matters.
  //
  // Platform functions are separated structurally rather than by name, so there is
  // no list here to fall out of date: Supabase's own helpers are pinned to
  // `pg_catalog`, while everything this file creates resolves in `public`. An
  // exception is still printed, never swallowed.
  const declaredFns = new Set(
    [...schemaCode.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:[A-Za-z_][A-Za-z0-9_]*\.)?([A-Za-z_][A-Za-z0-9_]*)/gi)]
      .map((m) => m[1].toLowerCase()),
  );
  const { rows: liveFns } = await client.query(`
    SELECT p.proname AS name,
           coalesce(array_to_string(p.proconfig, ','), '') AS config
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
     ORDER BY p.proname
  `);
  const platform = liveFns.filter((f) => /pg_catalog/.test(f.config));
  const projectFns = liveFns.filter((f) => !/pg_catalog/.test(f.config));
  const undeclaredFns = projectFns.filter((f) => !declaredFns.has(f.name.toLowerCase()));
  const absentFns = [...declaredFns].filter((name) => !projectFns.some((f) => f.name.toLowerCase() === name));

  console.log(`  declared functions: ${declaredFns.size}`);
  console.log(`  live functions    : ${liveFns.length}`);
  if (platform.length) console.log(`  platform functions: ${platform.map((f) => f.name).join(', ')} (not this project's)`);
  if (undeclaredFns.length) {
    console.log('  UNDECLARED FUNCTIONS (live but not in database/fatclinic.sql):');
    for (const f of undeclaredFns) console.log(`    - ${f.name}`);
    problems.push(
      `${undeclaredFns.length} function(s) exist in the database but not in the schema: ` +
        undeclaredFns.map((f) => f.name).join(', '),
    );
  }
  if (absentFns.length) {
    console.log('  MISSING FUNCTIONS (declared but not live):');
    for (const name of absentFns) console.log(`    - ${name}`);
    problems.push(`${absentFns.length} declared function(s) are absent from the database: ${absentFns.join(', ')}`);
  }
  if (!undeclaredFns.length && !absentFns.length) {
    console.log('  function drift   : none - schema and database agree');
  }
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

// Invoice arithmetic is the other piece of real logic, so exercise it.
//
// The probe must be undone, and the transaction has to be managed one
// client.query() at a time. Sending "BEGIN; <statements>" as a single
// parameterless query does NOT work: node-postgres then uses the simple query
// protocol, and PostgreSQL wraps the whole message in an implicit transaction
// that COMMITS at the end. The trailing ROLLBACK then arrives with no
// transaction open, raises "there is no transaction in progress", and used to be
// swallowed by a .catch(() => {}) - so every db:apply run left a fake
// "Schema Probe" patient, visit and invoice in the clinical tables. The assertion
// at the end of this block is what turned that from silent into visible.
let probeRows = [];
await client.query('BEGIN');
try {
  await client.query(`
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
  `);

  // A discount edit with no child-row change, which the old schema never
  // recalculated: the trigger only fired from invoice_items and payments.
  await client.query(`UPDATE invoices SET discount = 200 WHERE id LIKE 'VERIFY-PROBE-%'`);

  // Part-payment then moves the status along.
  await client.query(`
    INSERT INTO payments (id, invoice_id, receipt_number, amount, payment_method)
    SELECT 'PM-' || id, id, 'RCPT-' || id, 400, 'Cash' FROM invoices WHERE id LIKE 'VERIFY-PROBE-%'
  `);

  const { rows } = await client.query(
    `SELECT subtotal, discount, total, paid_amount, balance, payment_status
       FROM invoices WHERE id LIKE 'VERIFY-PROBE-%'`,
  );
  probeRows = rows;
} finally {
  await client.query('ROLLBACK');
}

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

// The rollback above is the whole reason this probe is safe to run against a
// database of real patient records, so it is asserted rather than assumed. A
// probe row surviving means the rollback silently failed, and every future run
// would add another one.
const { rows: leftover } = await client.query(
  `SELECT c.relname AS table, n.nspname
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname = ANY($1::text[])
      AND EXISTS (SELECT 1 FROM pg_attribute a
                   WHERE a.attrelid = c.oid AND a.attname = 'id' AND a.attnum > 0)`,
  [['patients', 'visits', 'invoices', 'invoice_items', 'payments']],
);
let strays = 0;
for (const t of leftover) {
  // The probe prefixes its own ids ('VIS-', 'II-', 'PM-'), so the marker is
  // matched anywhere in the id rather than at the start. A leading-anchored LIKE
  // quietly reported "clean" while three probe rows sat in the database.
  const { rows: found } = await client.query(
    `SELECT count(*)::int AS n FROM public."${t.table}" WHERE id LIKE '%VERIFY-PROBE-%'`,
  );
  if (found[0].n) {
    console.log(`    ${found[0].n} probe row(s) left in ${t.table} - the rollback did not take`);
    strays += found[0].n;
  }
}
if (strays) {
  problems.push(
    `${strays} invoice-probe row(s) survived the rollback, so db:apply is writing test data `
    + 'into the clinical tables. Delete them by hand before go-live:\n'
    + "    DELETE FROM payments       WHERE id LIKE '%VERIFY-PROBE-%';\n"
    + "    DELETE FROM invoice_items  WHERE id LIKE '%VERIFY-PROBE-%';\n"
    + "    DELETE FROM invoices       WHERE id LIKE '%VERIFY-PROBE-%';\n"
    + "    DELETE FROM visits         WHERE id LIKE '%VERIFY-PROBE-%';\n"
    + "    DELETE FROM patients       WHERE id LIKE '%VERIFY-PROBE-%';",
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
if (c.permission_nodes === 0) problems.push('permission_nodes seed missing');

// The staff count is deliberately NOT asserted. Zero is the correct state: the
// schema no longer seeds accounts, because a seeded account is a credential that
// ships to production. This used to check `users === 0` and call it a missing
// seed, which is the same condition as the correct one - so after the demo
// profiles were removed, a healthy database reported itself as broken. What is
// worth checking is that no invented clinician came back.
const { rows: demoRows } = await client.query(
  `SELECT id, email FROM users
    WHERE lower(email) = ANY($1::text[])
    ORDER BY id`,
  [DEMO_STAFF_EMAILS],
);
if (demoRows.length) {
  for (const d of demoRows) console.log(`    demo staff row still present: ${d.id} ${d.email}`);
  problems.push(
    `${demoRows.length} retired demo staff profile(s) are still in the users table. `
    + 'Run: npm run staff:clean-demo',
  );
}

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
  console.log('  Next:');
  console.log('    npm run db:check-rls      anon is blocked, and email self-signup is off');
  console.log('    npm run db:check-orphan  a valid session with no staff profile reads nothing');
  console.log('    npm run staff:add -- --name "..." --email ... --role ADMINISTRATOR');
  console.log('');
  console.log('  The schema seeds no staff accounts on purpose. A seeded account is a');
  console.log('  credential that ships to production, so sign-in accounts are created');
  console.log('  one at a time, by an administrator, with the service_role key.\n');
} else {
  console.log('  WARNING: Row Level Security was not applied. Do not expose this database.\n');
}
