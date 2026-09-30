/**
 * The laboratory workflow, end to end, against the running database.
 *
 * WHAT THE OTHER TWO CHECKS CANNOT REACH
 * --------------------------------------
 * `scripts/sync-selftest.mjs` drives the real row mappers into an in-memory fake
 * that enforces every foreign key parsed from the SQL. `scripts/check-lab-catalogue.mjs`
 * asks the running database whether its catalogue is right. Neither signs in, and
 * neither goes through PostgREST, so neither can notice that the *route* refuses a
 * write, that a column the row mapper sends does not exist, or that a policy admits
 * the read but not the write.
 *
 * That is not a theoretical gap. The whole report was "collect sample and the other
 * workflow changes do not save", and the reason could not be found in either file:
 * the mapper was right, the columns were right, and the status advanced in the
 * browser. What was missing was that the derived columns - when the specimen was
 * drawn, whether a critical alert was raised, who released the report - were never
 * in the row being written at all.
 *
 * So this does the whole thing for real, as a real Medical Laboratory Scientist:
 *
 *   1. Creates a throwaway clinician with a real sign-in account, so the writes
 *      carry a real JWT through the real row-level security policies rather than a
 *      service key that bypasses them. This is the arrangement `db:crud` uses.
 *   2. Registers a throwaway patient, visits them and orders a Full Blood Count,
 *      through the app's own `pushDiff`, in the app's own row mappers.
 *   3. Reads the catalogue back *as that clinician*, builds the entry rows from
 *      what came back with `buildRows`, and types sixteen values - one of them a
 *      haemoglobin of 7.9, which must be flagged Low, and one of them absent,
 *      which must not be stored at all.
 *   4. Walks the workflow the way the dashboard does: collect, process, enter,
 *      release. Each transition goes through the app's `applyStatusChange`.
 *   5. Reads every row back and compares it against what was entered, field by
 *      field. The draw time, the critical flag, the releaser and the timestamp are
 *      all asserted, because those are the four that were being dropped.
 *
 * Everything it creates is deleted at the end, and the deletion of the throwaway
 * sign-in account is confirmed against a fresh listing rather than trusted from
 * the `200` - a `200` from the admin endpoint has lied before.
 *
 * Run:  npm run db:crud-lab
 */
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { resolveConnection, shouldUseSsl } from './db-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const fromDir = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : ROOT;
      if (fs.existsSync(path.join(fromDir, specifier, 'index.ts'))) {
        return nextResolve(`${specifier}/index.ts`, context);
      }
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // Not a .ts file. Fall through to normal resolution.
      }
    }
    return nextResolve(specifier, context);
  },
});

const { TABLE_BY_KEY, pushDiff } = await import('../src/services/sync.ts');
const { applyStatusChange, buildRows, enteredRows, flagForValue, panelFor } =
  await import('../src/services/labResults.ts');

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
const EMAIL = `labflow-${stamp}@solacemedicares.com`;
const PASSWORD = `Panel-${stamp}!Margin7`;
const PROFILE = `USR-L${stamp}`;

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ''}`);
    failures += 1;
  }
};
const section = (line) => console.log(`\n${line}`);

const PATIENT = `FC-PANEL-${stamp}`;
const VISIT = `VIS-PANEL-${stamp}`;
const REQUEST = `LRQ-PANEL-${stamp}`;
const ORDER = `LTO-PANEL-${stamp}`;

const { options } = resolveConnection(env);
const sql = new pg.Client({ ...options, ssl: shouldUseSsl(options, env) ? { rejectUnauthorized: false } : undefined });
await sql.connect();

/** The throwaway account's id, held from the moment it exists so every exit can remove it. */
let throwawayId = null;

async function removeEverything() {
  // Patient first: everything below it cascades, and the order of deletion is the
  // only thing that could leave a row behind.
  await sql.query('DELETE FROM public.patients WHERE id = $1', [PATIENT]);
  await sql.query('DELETE FROM public.users WHERE id = $1', [PROFILE]);
  if (!throwawayId) return;
  const id = throwawayId;
  const res = await fetch(`${BASE}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: ADMIN });
  if (!res.ok) {
    console.error(`\n  !! the throwaway sign-in account could not be deleted (${res.status}).`);
    console.error(`     Remove ${EMAIL} by hand before going live.`);
    failures += 1;
    return;
  }
  // The `200` is not the evidence. A fresh listing is.
  const still = (await (await fetch(`${BASE}/auth/v1/admin/users?page=1&per_page=200`, { headers: ADMIN })).json()).users ?? [];
  const found = still.some((u) => (u.email ?? '').toLowerCase() === EMAIL.toLowerCase());
  if (found) {
    console.error(`\n  !! ${EMAIL} is still live on the server. Remove it by hand.`);
    failures += 1;
  }
  throwawayId = null;
}

let client;
try {
  // -------------------------------------------------------------------------
  section('a real sign-in, so the writes carry a real JWT');

  await sql.query(
    `insert into users (id, name, email, role, active, must_change_password)
     values ($1, 'Laboratory Flow', $2, 'LAB_SCIENTIST', true, false)`,
    [PROFILE, EMAIL.toLowerCase()],
  );
  const created = await fetch(`${BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: ADMIN,
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  });
  if (!created.ok) throw new Error(`could not create the throwaway account: ${created.status} ${await created.text()}`);
  throwawayId = (await created.json()).id;

  const grant = await (
    await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    })
  ).json();
  if (!grant.access_token) throw new Error('the throwaway account could not sign in');
  client = createClient(BASE, ANON, {
    global: { headers: { Authorization: `Bearer ${grant.access_token}` } },
    auth: { persistSession: false },
  });
  check('a Medical Laboratory Scientist signed in', true, EMAIL);

  // -------------------------------------------------------------------------
  section('order a Full Blood Count');

  const labDefs = TABLE_BY_KEY.get('fatclinic_lab_defs');
  const labRequests = TABLE_BY_KEY.get('fatclinic_lab_requests');

  // The catalogue is read as the signed-in clinician, through the API, not with a
  // service key. This is the read that result entry depends on: if the panel does
  // not come back here, the modal has nothing to render and the fall back is a
  // single free-text box.
  //
  // The embed is named `lab_parameters`, not `parameters`: that is what the child
  // table is called, and PostgREST resolves an embed through the foreign key. The
  // app does not embed - it fetches the child table separately and nests the rows
  // itself - so this is a second, independent way of proving the panel is
  // reachable, and it fails if the relationship is not in the schema cache.
  const cat = await client
    .from('lab_investigations')
    .select('id, code, name, price, lab_parameters(id, investigation_id, name, unit, reference_range, ref_low, ref_high, sort_order, result_type, options)')
    .eq('id', 'LAB-HEM-01')
    .single();
  check('the Full Blood Count panel reaches the browser through the API', !cat.error, cat.error?.message ?? '');

  // The nesting is done here rather than by `rowToModel`, because that is how the
  // app does it: `hydrateAll` fetches each child table on its own and hangs the
  // rows off the parent by foreign key. A mapper that quietly returned an empty
  // panel would defeat every check below, so it is done explicitly here too.
  const analyteMapper = labDefs.children[0];
  const definition = cat.data
    ? {
      ...labDefs.rowToModel({ ...cat.data, category: 'HEMATOLOGY', sample_type: 'EDTA Whole Blood' }),
      parameters: (cat.data.lab_parameters ?? []).map((r) => analyteMapper.rowToModel(r)),
    }
    : undefined;
  const panel = panelFor(definition);
  check('with every analyte, not one box', panel.length === 16, `${panel.length} analytes`);
  check('and the bounds that decide the flag', panel.filter((p) => p.refLow !== null || p.refHigh !== null).length >= 10, `${panel.filter((p) => p.refLow !== null || p.refHigh !== null).length} carry bounds`);
  check('in the order the panel declares', panel.every((p, i) => p.sortOrder >= (panel[i - 1]?.sortOrder ?? 0)), panel.map((p) => p.sortOrder).join(','));

  await pushDiff(
    TABLE_BY_KEY.get('fatclinic_patients'),
    [],
    [{
      id: PATIENT,
      firstName: 'Panel',
      lastName: 'Probe',
      dob: '1990-01-01',
      age: 36,
      sex: 'Female',
      phone: '+2348035992252',
      registeredAt: new Date().toISOString(),
    }],
    client,
  );
  await pushDiff(
    TABLE_BY_KEY.get('fatclinic_visits'),
    [],
    [{
      id: VISIT,
      patientId: PATIENT,
      visitDate: new Date().toISOString().slice(0, 10),
      visitType: 'New Visit',
      status: 'In Consultation',
      reasonForVisit: 'Laboratory flow check',
    }],
    client,
  );

  const order = {
    id: ORDER,
    requestId: REQUEST,
    testDefinitionId: 'LAB-HEM-01',
    testName: 'Full Blood Count',
    category: 'HEMATOLOGY',
    price: 15000,
    sampleType: 'EDTA Whole Blood',
    status: 'Requested',
    results: [],
  };
  const request = {
    id: REQUEST,
    visitId: VISIT,
    patientId: PATIENT,
    physicianId: null,
    physicianName: '',
    requestedAt: new Date().toISOString(),
    priority: 'Routine',
    paymentStatus: 'Paid',
    totalPrice: 15000,
    tests: [order],
  };
  await pushDiff(labRequests, [], [request], client);

  const stored = await client.from('lab_test_orders').select('*').eq('id', ORDER).single();
  check('the order is in the database', !stored.error, stored.error?.message ?? '');
  check('and it starts as Requested', stored.data?.status === 'Requested', stored.data?.status);
  check('with no draw time recorded', !stored.data?.collected_at, String(stored.data?.collected_at));

  // -------------------------------------------------------------------------
  section('enter sixteen analytes');

  // A blood film that means something: a haemoglobin of 7.9 with a low red cell
  // count, a low packed cell volume, a small and pale cell - microcytic,
  // hypochromic anaemia - plus a white cell count of 13.1 and a reactive
  // neutrophilia. Several analytes are therefore genuinely abnormal, and the flags
  // below say which, so the check is that every one of them is judged against its
  // own interval rather than defaulted.
  //
  // Two analytes are left blank on purpose: they must be absent from the database,
  // not stored as an empty result with a Normal flag - which is how a report comes
  // to claim sixteen analytes when fourteen were run.
  const typed = {
    'LAB-HEM-01.p_hb': ['7.9', 'Low'],
    'LAB-HEM-01.p_rbc': ['2.48', 'Low'],
    'LAB-HEM-01.p_pcv': ['24.6', 'Low'],
    'LAB-HEM-01.p_mcv': ['72.4', 'Low'],
    'LAB-HEM-01.p_mch': ['25.1', 'Low'],
    'LAB-HEM-01.p_mchc': ['32.3', 'Normal'],
    'LAB-HEM-01.p_rdw': ['14.2', 'High'],
    'LAB-HEM-01.p_wbc': ['13.1', 'High'],
    'LAB-HEM-01.p_neut': ['78', 'High'],
    'LAB-HEM-01.p_lymph': ['17', 'Low'],
    'LAB-HEM-01.p_mono': ['4', 'Normal'],
    'LAB-HEM-01.p_eos': ['1', 'Normal'],
    'LAB-HEM-01.p_baso': ['0', 'Normal'],
    'LAB-HEM-01.p_plt': ['186', 'Normal'],
    // p_mpv (mean platelet volume) and p_morph (morphology) deliberately blank.
  };
  const expectedFlags = new Map(Object.entries(typed).map(([id, [value, flag]]) => [id, flag]));

  let rows = buildRows(panel, []);
  rows = rows.map((r) => {
    const entry = typed[r.parameterId];
    if (entry === undefined) return r;
    const [value] = entry;
    const parameter = panel.find((p) => p.id === r.parameterId);
    return { ...r, value, flag: flagForValue(parameter, value, 'Normal') };
  });
  const wrongFlags = rows
    .filter((r) => expectedFlags.has(r.parameterId))
    .filter((r) => r.flag !== expectedFlags.get(r.parameterId))
    .map((r) => `${r.parameterId} ${r.value} flagged ${r.flag}, expected ${expectedFlags.get(r.parameterId)}`);
  check('every analyte is judged against its own interval', wrongFlags.length === 0, wrongFlags.join('; '));
  check('the microcytic indices are all flagged Low', ['p_hb', 'p_rbc', 'p_pcv', 'p_mcv', 'p_mch'].every((k) => rows.find((r) => r.parameterId === `LAB-HEM-01.${k}`)?.flag === 'Low'));
  check('the reactive white count is High', rows.find((r) => r.parameterId === 'LAB-HEM-01.p_wbc')?.flag === 'High');
  check('and the platelets are Normal', rows.find((r) => r.parameterId === 'LAB-HEM-01.p_plt')?.flag === 'Normal');
  check('and the two blanks are still blank', rows.filter((r) => !expectedFlags.has(r.parameterId)).every((r) => r.value === ''));

  const saved = enteredRows(rows);
  check('fourteen analytes are saved, not sixteen', saved.length === 14, `${saved.length} rows`);
  await pushDiff(
    labRequests,
    [request],
    [{ ...request, tests: [{ ...order, results: saved }] }],
    client,
  );

  const readResults = await client.from('lab_results').select('*').eq('test_order_id', ORDER);
  check('the database holds exactly the fourteen that were entered', readResults.data?.length === 14, `${readResults.data?.length} rows`);
  check('the haemoglobin came back as 7.9', readResults.data?.find((r) => r.parameter_id === 'LAB-HEM-01.p_hb')?.value === '7.9');
  check('flagged Low in the database, not in the browser', readResults.data?.find((r) => r.parameter_id === 'LAB-HEM-01.p_hb')?.flag === 'Low');
  check('with its unit and its printed range', (() => {
    const r = readResults.data?.find((x) => x.parameter_id === 'LAB-HEM-01.p_hb');
    return r?.unit === 'g/dL' && r?.reference_range === '12.0 - 17.5';
  })());
  check('and the two untouched analytes were not stored at all', (readResults.data ?? []).every((r) => r.value !== ''));
  check('no result is left pointing at an analyte the panel does not have', (readResults.data ?? []).every((r) => r.parameter_id.startsWith('LAB-HEM-01.')));

  // -------------------------------------------------------------------------
  section('collect, process, enter and release');

  let current = { ...order, results: saved };
  const advance = async (status, extra = {}) => {
    current = applyStatusChange(current, status, { user: { id: PROFILE, name: 'Laboratory Flow' }, results: current.results, ...extra });
    await pushDiff(
      labRequests,
      [{ ...request, tests: [{ ...order, results: saved }] }],
      [{ ...request, tests: [current] }],
      client,
    );
    const row = (await client.from('lab_test_orders').select('*').eq('id', ORDER).single()).data;
    return row;
  };

  const collected = await advance('Sample Collected');
  check('the status reached the database', collected?.status === 'Sample Collected', collected?.status);
  check('and the draw time was written', !!collected?.collected_at, String(collected?.collected_at));
  check('with the scientist who took it', collected?.scientist_name === 'Laboratory Flow' && collected?.scientist_id === PROFILE);

  const drawnAt = collected?.collected_at;
  const processing = await advance('Processing');
  check('processing does not move the draw time', processing?.collected_at === drawnAt, String(processing?.collected_at));

  // The critical alert. This is the flag that used to be a checkbox that set a
  // state and dropped it, so a critical value was released with urgent
  // notification off.
  const entered = await advance('Result Entered', { criticalAlert: false });
  check('result entry is saved', entered?.status === 'Result Entered', entered?.status);
  check('with no alert raised', entered?.critical_alert === false);
  check('and the results are still attached', (await client.from('lab_results').select('id').eq('test_order_id', ORDER)).data?.length === 14);

  const released = await advance('Released', { criticalAlert: true, comments: 'Haemoglobin below the critical threshold - physician notified by telephone.' });
  check('the release is saved', released?.status === 'Released', released?.status);
  check('with the release time', !!released?.released_at, String(released?.released_at));
  check('and the name of whoever released it', released?.verified_by === 'Laboratory Flow', String(released?.verified_by));
  check('the critical alert is on the row, not just in the browser', released?.critical_alert === true);
  check('the comment is stored', String(released?.comments ?? '').startsWith('Haemoglobin below'), String(released?.comments));
  check('the draw time survived the whole workflow', released?.collected_at === drawnAt);
  check('and the scientist is still recorded', released?.scientist_id === PROFILE);

  // -------------------------------------------------------------------------
  section('and it all reads back as a released report');

  // The physician's view: the released order, the analytes, the flags. This is the
  // query a released report is built from.
  const report = await client
    .from('lab_test_orders')
    .select('id, test_name, status, collected_at, released_at, verified_by, critical_alert, lab_results(parameter_id, parameter_name, value, unit, reference_range, flag)')
    .eq('id', ORDER)
    .single();
  check('the report loads', !report.error, report.error?.message ?? '');
  const results = (report.data?.lab_results ?? []).sort((a, b) => a.parameter_id.localeCompare(b.parameter_id));
  check('with fourteen analytes on it', results.length === 14, `${results.length}`);
  const reportWrong = results
    .filter((r) => r.flag !== expectedFlags.get(r.parameter_id))
    .map((r) => `${r.parameter_id} reported as ${r.flag}, expected ${expectedFlags.get(r.parameter_id)}`);
  check('every analyte carries the flag its own interval gave it', reportWrong.length === 0, reportWrong.join('; '));
  check('the abnormal haemoglobin is flagged on the report itself', results.find((r) => r.parameter_id === 'LAB-HEM-01.p_hb')?.flag === 'Low');
  check('the high white cell count too', results.find((r) => r.parameter_id === 'LAB-HEM-01.p_wbc')?.flag === 'High');
  check('no analyte is reported as Critical, because nothing was ever marked Critical', results.every((r) => r.flag !== 'Critical'));
  check('and the two that were not run are not on the report at all', (report.data?.lab_results ?? []).every((r) => r.value !== ''));
} catch (err) {
  console.error(`\n  the run could not finish: ${err.message}`);
  failures += 1;
} finally {
  await removeEverything();
  await sql.end();
}

console.log('');
console.log(
  failures
    ? `[check-lab-workflow] ${failures} check(s) failed.`
    : '[check-lab-workflow] a scientist ordered, collected, entered and released a Full Blood Count, and every field came back out of the database.',
);
if (failures) process.exitCode = 1;
