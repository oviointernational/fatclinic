/**
 * The laboratory catalogue, in the running database.
 *
 * WHAT THIS CHECKS, AND WHY IT CANNOT BE A UNIT TEST
 * -------------------------------------------------
 * `scripts/sync-selftest.mjs` proves the app renders a panel correctly given one,
 * and that the browser's copy of the catalogue matches the seed in
 * database/fatclinic.sql. Neither of those can see the database. The bug this was
 * written for lived entirely in the database: five investigations had panels in
 * the seed and none in `lab_parameters`, so a full blood count rendered a single
 * free-text box and stored one string where sixteen numbers belonged. Every test
 * in the repository passed, because every one of them was reading the catalogue
 * from a file the database had never been asked to agree with.
 *
 * So this asks the database directly, and answers the questions a scientist's
 * screen would put:
 *
 *   1. Does every investigation a doctor can order have analytes to enter? An
 *      investigation with no panel does not fail - it falls back to one box, and
 *      a blood count in one box is indistinguishable from a haemoglobin on a
 *      report.
 *   2. Is a recorded result still attached to an analyte that exists? The rename
 *      of the analyte ids repointed them; a result pointing at nothing would be
 *      kept (the sync self-test demands orphan retention rather than deletion) and
 *      therefore has to be visible here.
 *   3. Do the bounds beside each printed range agree with the printed range? These
 *      are two copies of one fact, written by hand, and they drift.
 *   4. Can a signed-in staff member read the panel, and can they not write it?
 *      Read is what result entry needs. Not-write is what keeps a device holding
 *      an out-of-date copy from reverting the catalogue - see the REVOKE in
 *      database/fatclinic.sql.
 *
 * Every statement is read-only. The privilege probes run inside a transaction
 * that is rolled back, so this leaves the database exactly as it found it.
 *
 * Run:  npm run db:check-lab-catalogue
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { readCatalogueSeed, boundsIn } from './lab-catalogue-seed.mjs';

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

const seed = readCatalogueSeed(readFileSync(new URL('../database/fatclinic.sql', import.meta.url), 'utf8'));

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  PASS  ${label}${detail ? `  (${detail})` : ''}`);
  else {
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ''}`);
    failures += 1;
  }
};
const section = (line) => console.log(`\n${line}`);

const db = new pg.Client({
  host: env.PGHOST,
  port: Number(env.PGPORT),
  user: env.PGUSER,
  password: env.PGPASSWORD,
  database: env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

// ---------------------------------------------------------------------------
section('1. does every investigation have analytes to enter?');

const panel = await db.query(
  `SELECT i.id, i.code, i.name, i.active,
          count(p.id)::int AS analytes,
          count(p.id) FILTER (WHERE p.result_type = 'numeric')::int AS numeric,
          count(p.id) FILTER (WHERE p.result_type = 'select')::int AS selects
     FROM public.lab_investigations i
     LEFT JOIN public.lab_parameters p ON p.investigation_id = i.id
    GROUP BY i.id, i.code, i.name, i.active
    ORDER BY i.code`,
);

for (const row of panel.rows) {
  // The label an ordering is asserted on: a panel is present, or it is not.
  check(`${row.code} has a panel`, row.analytes > 0, `${row.analytes} analytes${row.active === false ? ' (investigation inactive)' : ''}`);
}

// The specific panel the bug was reported about, named rather than averaged: a
// count of "every investigation has some analytes" would have been satisfied by
// one analyte on a full blood count, which is the failure in a different size.
const fbc = panel.rows.find((r) => r.id === 'LAB-HEM-01');
check('a full blood count has its full panel', (fbc?.analytes ?? 0) >= 14, `${fbc?.analytes ?? 0} analytes`);

const emptyPanels = panel.rows.filter((r) => r.analytes === 0 && r.active !== false);
check('no investigation a doctor can order is left without a panel', emptyPanels.length === 0, emptyPanels.map((r) => r.code).join(', ') || 'none');

const emptyActive = panel.rows.filter((r) => r.analytes === 0);
if (emptyActive.length) {
  console.log(`      ${emptyActive.map((r) => r.code).join(', ')}: a one-box investigation, which the result-entry screen now says out loud`);
}

// ---------------------------------------------------------------------------
section('2. are the analyte ids sound?');

const rows = (await db.query('SELECT * FROM public.lab_parameters ORDER BY investigation_id, sort_order, id')).rows;
const params = new Map(rows.map((r) => [r.id, r]));

check('every id names the investigation it belongs to', rows.every((r) => r.id.startsWith(`${r.investigation_id}.`)), `${rows.filter((r) => !r.id.startsWith(`${r.investigation_id}.`)).map((r) => r.id).join(', ') || 'all sound'}`);
check('no id is prefixed twice', rows.every((r) => r.id.split('.').length === 2), `${rows.filter((r) => r.id.split('.').length !== 2).map((r) => r.id).join(', ') || 'none'}`);

// The reason the ids are namespaced rather than bare: one analyte on two panels.
const bare = rows.filter((r) => !r.id.includes('.'));
check('no analyte id is bare', bare.length === 0, bare.map((r) => r.id).join(', ') || 'none');
const sharedKey = new Map();
for (const r of rows) {
  const key = r.id.split('.').pop();
  if (!sharedKey.has(key)) sharedKey.set(key, []);
  sharedKey.get(key).push(r.id);
}
const shared = [...sharedKey.entries()].filter(([, ids]) => ids.length > 1);
console.log(`      ${shared.length} analyte(s) appear on more than one panel, which is what the namespace is for:`);
for (const [key, ids] of shared) console.log(`        ${key.padEnd(16)} ${ids.join(', ')}`);

// ---------------------------------------------------------------------------
section('3. do the printed ranges and the bounds agree?');

// Two hand-written copies of one fact. When they disagree the result is flagged
// against a limit the report does not show, which is worse than not flagging it.
const disagreeing = [];
const noBoundsButNumeric = [];
const noIntervalByDesign = [];
for (const r of rows) {
  const printed = boundsIn(r.reference_range);
  const low = r.ref_low === null ? null : Number(r.ref_low);
  const high = r.ref_high === null ? null : Number(r.ref_high);
  const same = (a, b) => (a === null ? b === null : b !== null && Number(a) === Number(b));
  if (!same(printed?.low ?? null, low) || !same(printed?.high ?? null, high)) {
    disagreeing.push(`${r.id} prints "${r.reference_range}" but is judged ${low ?? '-'}..${high ?? '-'}`);
  }
  // A numeric analyte with no bounds is a result that can never be flagged, which
  // is legitimate only where the analyte genuinely has no interval - a polymerase
  // chain reaction's cycle threshold, "Not applicable" on a negative specimen.
  //
  // Where the printed range contains a digit it is not legitimate: "4.0 - 5.6
  // (Non-Diabetic)" is two numbers and a gloss, and the gloss alone is enough to
  // stop the flag reading it - so a diabetic HbA1c is recorded as Normal forever.
  // That is this whole defect shrunk to one row, and the live database carried it
  // until the migration printed the range as the numbers it compares.
  if (r.result_type === 'numeric' && printed === null && low === null && high === null) {
    (/\d/.test(r.reference_range ?? '') ? noBoundsButNumeric : noIntervalByDesign)
      .push(`${r.id} ("${r.reference_range}")`);
  }
}
check('every printed range agrees with the bounds beside it', disagreeing.length === 0, disagreeing.join('; ') || 'all agree');
for (const line of disagreeing) console.log(`        ${line}`);

check('every numeric range is one the flag can read', noBoundsButNumeric.length === 0, `${noBoundsButNumeric.length} of them`);
for (const line of noBoundsButNumeric.slice(0, 12)) console.log(`        ${line}`);
if (noIntervalByDesign.length) {
  console.log(`      ${noIntervalByDesign.length} numeric analyte(s) have no interval by design, and are flagged by the scientist:`);
  for (const line of noIntervalByDesign) console.log(`        ${line}`);
}

const oneSided = rows.filter((r) => (r.ref_low === null) !== (r.ref_high === null));
check('a one-sided range is recorded as one side, not both', oneSided.every((r) => boundsIn(r.reference_range) !== null), oneSided.map((r) => r.id).join(', ') || 'all readable');

const optionless = rows.filter((r) => (r.result_type === 'select' || r.result_type === 'reactive') && !(r.options ?? []).length);
check('every dropdown has options to choose from', optionless.length === 0, optionless.map((r) => r.id).join(', ') || 'none');

// ---------------------------------------------------------------------------
section('4. does the seed and the running database agree?');

const seedById = new Map(seed.flatMap((i) => i.parameters.map((p) => [p.id, { ...p, investigation: i.id }])));
const drifted = [];
for (const r of rows) {
  const s = seedById.get(r.id);
  if (!s) {
    drifted.push(`${r.id} is in the database and not in the seed`);
    continue;
  }
  const diffs = [];
  if (r.investigation_id !== s.investigation) diffs.push(`panel ${r.investigation_id} vs ${s.investigation}`);
  if (r.name !== s.name) diffs.push(`name "${r.name}" vs "${s.name}"`);
  if (r.reference_range !== s.referenceRange) diffs.push(`range "${r.reference_range}" vs "${s.referenceRange}"`);
  if ((r.ref_low === null ? null : Number(r.ref_low)) !== s.refLow) diffs.push(`ref_low ${r.ref_low} vs ${s.refLow}`);
  if ((r.ref_high === null ? null : Number(r.ref_high)) !== s.refHigh) diffs.push(`ref_high ${r.ref_high} vs ${s.refHigh}`);
  if (Number(r.sort_order) !== s.sortOrder) diffs.push(`sort_order ${r.sort_order} vs ${s.sortOrder}`);
  if (r.result_type !== s.resultType) diffs.push(`result_type ${r.result_type} vs ${s.resultType}`);
  if (JSON.stringify(r.options ?? []) !== JSON.stringify(s.options)) diffs.push(`options ${JSON.stringify(r.options)} vs ${JSON.stringify(s.options)}`);
  if (diffs.length) drifted.push(`${r.id}: ${diffs.join('; ')}`);
}
check('the database says what the seed says', drifted.length === 0, `${drifted.length} of ${rows.length} differ`);
for (const line of drifted.slice(0, 12)) console.log(`        ${line}`);

const missing = [...seedById.keys()].filter((id) => !params.has(id));
check('and nothing in the seed is absent from the database', missing.length === 0, missing.join(', ') || 'none');

// A report that lists its analytes in whatever order the database returned them
// is not a report: the panel's own sequence is the reading order a scientist and
// a physician both expect.
const dupOrder = panel.rows
  .map(({ id }) => {
    const here = rows.filter((r) => r.investigation_id === id);
    return [id, here.length, new Set(here.map((r) => Number(r.sort_order))).size];
  })
  .filter(([, total, distinct]) => total !== distinct);
check('every panel has a defined report order', dupOrder.length === 0, dupOrder.map(([inv, total, distinct]) => `${inv}: ${total} analytes, ${distinct} positions`).join('; ') || 'no two analytes share a position');

// ---------------------------------------------------------------------------
section('5. does a recorded result still point at an analyte that exists?');

const results = await db.query(
  `SELECT r.id, r.parameter_id, r.value,
          p.id IS NOT NULL AS resolves,
          o.id IS NOT NULL AS order_exists
     FROM public.lab_results r
     LEFT JOIN public.lab_parameters p ON p.id = r.parameter_id
     LEFT JOIN public.lab_test_orders o ON o.id = r.test_order_id`,
);
const orphans = results.rows.filter((r) => !r.resolves);
check(`every recorded result names an analyte the panel has`, orphans.length === 0, `${orphans.length} of ${results.rows.length}: ${orphans.slice(0, 5).map((r) => r.parameter_id).join(', ')}`);
const detached = results.rows.filter((r) => r.order_exists);
check('and every recorded result belongs to a test order', detached.length === 0, `${detached.length} of ${results.rows.length}`);
console.log(`      ${results.rows.length} result(s) recorded`);

// The live orders are what make the next check meaningful: a panel can be correct
// and still not be the one a patient's pending test uses.
const liveOrders = await db.query(
  `SELECT o.id, o.status, o.test_definition_id, i.name, count(p.id)::int AS analytes
     FROM public.lab_test_orders o
     LEFT JOIN public.lab_investigations i ON i.id = o.test_definition_id
     LEFT JOIN public.lab_parameters p ON p.investigation_id = o.test_definition_id
    GROUP BY o.id, o.status, o.test_definition_id, i.name
    ORDER BY o.id`,
);
const unresolvable = liveOrders.rows.filter((r) => !r.test_definition_id);
check('every live test order names an investigation that exists', unresolvable.length === 0, unresolvable.map((r) => `${r.id} -> ${r.test_definition_id ?? '(none)'}`).join(', ') || 'none');
const boxless = liveOrders.rows.filter((r) => r.test_definition_id && r.analytes === 0);
check('no live test order lands on the one-box screen', boxless.length === 0, boxless.map((r) => `${r.id} -> ${r.test_definition_id}`).join(', ') || 'none');
for (const r of liveOrders.rows) {
  console.log(`      ${r.id.padEnd(14)} ${r.status.padEnd(11)} ${String(r.analytes).padStart(2)} analytes  ${r.name ?? '(investigation missing)'}`);
}

// ---------------------------------------------------------------------------
section('6. can a signed-in staff member read the panel, and not write it?');

// PostgREST runs these as `authenticated` with the JWT's claims in a GUC, and a
// direct connection has neither, so both are set here exactly as the gateway
// sets them - otherwise a refusal below would prove only that the column grants
// were checked against the wrong role. Each probe is rolled back.
const staff = await db.query(
  `SELECT email FROM public.users WHERE active ORDER BY
      CASE role WHEN 'ADMIN' THEN 0 ELSE 1 END, created_at LIMIT 1`,
);
const claims = JSON.stringify({ email: staff.rows[0]?.email ?? '', role: 'authenticated' });
const asSession = async (fn) => {
  await db.query('begin');
  try {
    await db.query('set local role authenticated');
    await db.query('select set_config($1, $2, true)', ['request.jwt.claims', claims]);
    return await fn();
  } finally {
    await db.query('rollback').catch(() => {});
  }
};

const readable = await asSession(() => db.query(
  `SELECT count(*)::int AS n FROM public.lab_parameters
    WHERE ref_low IS NOT NULL OR ref_high IS NOT NULL`,
)).then((r) => r.rows[0].n, (e) => { console.log(`      ${e.message}`); return -1; });
// A count, not a boolean: the point is that a scientist receives the bounds, since
// the bounds are what the result-entry screen decides Normal / Low / High with.
check('a staff member reads the panel with its bounds', readable > 0, `${readable} analytes with bounds`);

// Each probe supplies every column the table insists on, so what comes back is
// about the grant rather than about a NOT NULL constraint: a refusal on a
// constraint would read as "the insert failed" and would satisfy a check that is
// asking whether the privilege was withdrawn.
const refused = async (label, sql) => {
  const error = await asSession(() => db.query(sql)).then(() => null, (e) => e);
  if (!error) return false;
  // 42501 is "insufficient privilege". Anything else is a different failure and
  // would make this check pass for the wrong reason, which is worse than failing.
  if (!/42501|permission denied/i.test(error.message)) {
    console.log(`      ${label}: expected a permission refusal, got ${error.message}`);
  }
  return /42501|permission denied/i.test(error.message);
};

check('but cannot insert an analyte', await refused(
  'insert',
  `INSERT INTO public.lab_parameters
     (id, investigation_id, name, unit, reference_range, result_type, options)
   VALUES ('x', 'LAB-HEM-01', 'x', '', '', 'text', '{}')`,
));
check('cannot change a reference range', await refused(
  'update',
  `UPDATE public.lab_parameters SET reference_range = reference_range
    WHERE investigation_id = 'LAB-HEM-01'`,
));
check('cannot delete an analyte', await refused(
  'delete',
  `DELETE FROM public.lab_parameters WHERE investigation_id = 'LAB-HEM-01'`,
));

// The revoke has to be narrow, and this is where a check like the three above is
// usually wrong: a blood count is unwritable, a result on it is not. Stopping at
// the refusals would pass against a table nobody can save anything to, and the
// scientist would find that out at the moment they released a result.
const orderSaved = await asSession(() => db.query(
  `UPDATE public.lab_test_orders SET status = status
    WHERE id = (SELECT min(id) FROM public.lab_test_orders)
    RETURNING id`,
)).then((r) => r.rows.length, (e) => { console.log(`      ${e.message}`); return 0; });
check('a test order can still be advanced by a staff member', orderSaved === 1, 'in a rolled-back transaction');

const resultSaved = await asSession(() => db.query(
  `INSERT INTO public.lab_results
     (id, test_order_id, parameter_id, parameter_name, value, unit, reference_range, flag)
   VALUES ('tmp-catalogue-probe',
           (SELECT min(id) FROM public.lab_test_orders),
           'LAB-HEM-01.p_hb', 'Hemoglobin (Hb)', '13.4', 'g/dL', '12.0 - 17.5', 'Normal')
   RETURNING id`,
)).then((r) => r.rows.length, (e) => { console.log(`      ${e.message}`); return 0; });
check('and a result can still be saved against a panel analyte', resultSaved === 1, 'the row a haemoglobin entry writes');

// ---------------------------------------------------------------------------
console.log('');
console.log(
  failures
    ? `[check-lab-catalogue] ${failures} check(s) failed.`
    : `[check-lab-catalogue] every check passed. ${rows.length} analytes across ${panel.rows.length} investigations, read-only for clients.`,
);
await db.end();
if (failures) process.exitCode = 1;
