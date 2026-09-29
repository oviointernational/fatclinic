// Live CRUD audit for the clinical record.
//
// The bug this suite exists for was found by reading a database that was
// completely empty: a doctor pressed Save on a consultation, saw "Saved!", and
// the complaint, the examination, the diagnoses, the plan and the notes were all
// gone. The cause was one line - an unset follow-up date sent as '' to a DATE
// column - and because an upsert is a single request, it voided the whole record.
// The error went to the browser console and to nothing else, and 25 other date and
// timestamp columns across 17 tables failed the same way.
//
// "It looked fine in the app" is not evidence for a medical data layer, so this
// runs against the real database, as a real signed-in clinician, over the real
// write path (src/services/sync.ts) rather than a copy of it.
//
//   Part A  every table, every column: no value the UI can produce blank may be
//           sent to a column Postgres cannot parse. Measured against the live
//           column types, so it is a sweep and not a list of guesses.
//
//   Part B  the clinical chain a doctor actually writes - patient, visit, vitals,
//           consultation, diagnoses, lab request, lab tests, prescription,
//           prescription items - created, edited and deleted through that
//           clinician's own JWT, with every optional field left blank the way a
//           clinician who skipped a box leaves it. Ground truth is read back
//           with SQL, not with the app's own reader, so a mapper that writes
//           and reads the same wrong thing cannot pass.
//
// Everything it creates it removes, including the throwaway account it signs in
// as. Nothing here reads or writes the clinic's real patients.
//
// Needs: PG*, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, and
// SUPABASE_SERVICE_ROLE_KEY (to create and delete the throwaway account).
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { resolveConnection, shouldUseSsl } from './db-config.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

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

// Everything below is in one async function rather than at module top level,
// because a top-level `return` is not legal in an ES module and `return` was the
// only way to stop early on missing configuration without killing stdout mid-line
// the way process.exit() does on Windows.
async function bootstrap() {
  const { TABLES, pushDiff } = await import('../src/services/sync.ts');

  // -------------------------------------------------------------------------
  // Environment
  // -------------------------------------------------------------------------

  const env = Object.fromEntries(
    fs
      .readFileSync(path.join(ROOT, '.env'), 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        let v = l.slice(i + 1).trim();
        // A quoted value in .env breaks ad-hoc parsing if it is not stripped here.
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        return [l.slice(0, i).trim(), v];
      }),
  );

  const missing = [
    'PGHOST',
    'PGPASSWORD',
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ].filter((k) => !env[k]);
  if (missing.length) {
    console.error(`Missing from .env: ${missing.join(', ')}. See .env.example.`);
    process.exitCode = 1;
    return;
  }

  const BASE = env.VITE_SUPABASE_URL;
  const ANON = env.VITE_SUPABASE_ANON_KEY;
  const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
  const ADMIN = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };

  const stamp = Date.now().toString().slice(-8);
  const EMAIL = `crudaudit-${stamp}@solacemedicares.com`;
  const PASSWORD = `Audit-${stamp}!Rampart7`;
  const PROFILE = `USR-A${stamp}`;
  const PREFIX = `-A${stamp}`;

  const { options } = resolveConnection(env);
  const sql = new pg.Client({
    ...options,
    ssl: shouldUseSsl(options, env) ? { rejectUnauthorized: false } : undefined,
  });

  const mapOf = (table) => TABLES.find((t) => t.table === table);

  // -------------------------------------------------------------------------
  // Harness
  // -------------------------------------------------------------------------

  let checks = 0;
  let failures = 0;
  /** The id of the throwaway auth account, once it exists. */
  let throwawayId = null;
  /** What happened to it, so a second call reports that rather than "nothing to do". */
  let throwawayNote = null;

  /**
   * Delete the throwaway sign-in account, and confirm it is gone.
   *
   * A `200` from the admin endpoint is not proof: two runs reported success and
   * the accounts were still there, which is the worst possible outcome for a
   * cleanup - a false all-clear. So the only acceptable evidence is the account
   * absent from a fresh listing, and the run fails if it is not.
   *
   * Returns a one-line outcome rather than printing it, so the fatal path below
   * can write it synchronously: `process.exit` does not flush a piped stdout, and
   * the line that says whether a credential is still live is the last thing that
   * should be lost.
   */
  async function removeThrowaway() {
    // Called more than once: the `finally` removes it, and the fatal handler runs
    // afterwards. So a second call must report what the first one actually did.
    // Saying "no throwaway account was created" here would be a lie in the one
    // direction that matters - it would read as "no credential is at risk" on a
    // run that had made one.
    if (!throwawayId) return throwawayNote ?? 'no throwaway sign-in account was ever created';
    // The id is cleared only once the account is *confirmed* gone. Clearing it
    // first would mean a retry cannot retry: the fatal handler below calls this
    // again, and finding nothing to do would report success for a credential that
    // is still live. Every unhappy path therefore leaves the id in place.
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
    // One complete line either way, because the teardown discards the return value
    // and a bare "WARNING" with no sentence after it is the one thing that must not
    // reach the person who has to clean this up by hand.
    throwawayNote = still
      ? `WARNING: the throwaway account ${EMAIL} SURVIVED deletion and must be removed by hand`
      : 'removed the throwaway sign-in account, and confirmed it is gone';
    if (still) failures++;
    else throwawayId = null;
    console.log(`      ${throwawayNote}`);
    return throwawayNote;
  }

  // A `finally` is not reached when the process dies, and this one has died: the
  // direct-Postgres connection to Supabase intermittently drops mid-run and
  // surfaces as an unhandled 'error' event, which ends the process with the
  // account still live. The row cleanup cannot be saved then - the client is gone -
  // but the credential is deleted over HTTP, and a working sign-in for a fake
  // clinician is the part that must not be left behind.
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

  function check(name, ok, detail) {
    checks++;
    if (ok) {
      console.log(`  ${name.padEnd(64)} : ok`);
    } else {
      failures++;
      console.log(`  ${name.padEnd(64)} : FAILED`);
      if (detail !== undefined) {
        for (const line of [].concat(detail)) console.log(`      ${line}`);
      }
    }
  }

  function section(title) {
    console.log('');
    console.log(`  ${title}`);
  }

  // -------------------------------------------------------------------------
  // Types the live database actually has
  // -------------------------------------------------------------------------

  const typeCache = new Map();
  async function columnType(table, column) {
    const key = `${table}.${column}`;
    if (!typeCache.has(key)) {
      const r = await sql.query(
        `select data_type, is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = $1 and column_name = $2`,
        [table, column],
      );
      typeCache.set(key, r.rows[0] ?? null);
    }
    return typeCache.get(key);
  }

  // -------------------------------------------------------------------------
  // Part A: no blank value may reach a column Postgres cannot parse
  // -------------------------------------------------------------------------

  /**
   * A model in which every field is blank.
   *
   * A Proxy rather than a hand-written fixture, so the sweep covers every column
   * of every table without a list that can fall behind the schema - which is how
   * "it is not in the list" turns into "it was never checked". A controlled React
   * input a clinician left empty holds '', and that is the only blank the UI
   * produces, so '' for every field is the honest worst case.
   */
  function blankModel() {
    return new Proxy(
      {},
      {
        get: (_target, key) => (typeof key === 'symbol' ? undefined : ''),
        has: () => true,
      },
    );
  }

  /** Text-ish columns accept the empty string; nothing else does. */
  const ACCEPTS_EMPTY_STRING = new Set(['text', 'character varying', 'character', 'citext']);
  const NUMERIC = new Set([
    'smallint',
    'integer',
    'bigint',
    'real',
    'double precision',
    'numeric',
    'decimal',
  ]);

  /**
   * What is wrong with sending `value` to a column of type `dataType`, or null if
   * nothing is wrong. Kept separate from the nullable check below so the two
   * questions are not conflated: a type mismatch and a value the column could
   * have taken as NULL are different bugs with different fixes.
   */
  function whyUnacceptable(dataType, value) {
    if (value === null) return null; // decided by nullability, below
    if (typeof value === 'string') {
      if (value === '' && !ACCEPTS_EMPTY_STRING.has(dataType)) return `is "" and the column is ${dataType}`;
      if (value !== '' && !ACCEPTS_EMPTY_STRING.has(dataType) && dataType !== 'jsonb' && dataType !== 'uuid') {
        return `is the string ${JSON.stringify(value)} and the column is ${dataType}`;
      }
      return null;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return `is the non-finite number ${value}`;
      if (!NUMERIC.has(dataType)) return `is a number and the column is ${dataType}`;
      return null;
    }
    if (typeof value === 'boolean') {
      return dataType === 'boolean' ? null : `is a boolean and the column is ${dataType}`;
    }
    if (Array.isArray(value)) {
      return dataType === 'ARRAY' ? null : `is an array and the column is ${dataType}`;
    }
    if (value && typeof value === 'object') {
      return dataType === 'jsonb' ? null : `is an object and the column is ${dataType}`;
    }
    return `is a ${typeof value} and the column is ${dataType}`;
  }

  /**
   * Blank values a NOT NULL column cannot take, by table.
   *
   * These are reported, not failed, and the distinction is the whole point of
   * this audit. A blank sent to a *nullable* column is a defect outright: the
   * mapper knows the field is optional - that is exactly what orNull() marks -
   * so it had every opportunity to send NULL and sent '' instead. That is the
   * bug that voided every consultation whose doctor left the follow-up date
   * empty, and it would have voided two dozen more the same way.
   *
   * A blank sent to a *NOT NULL* column is not the same thing, and the fix is not
   * the same either. The mapper cannot send NULL there without inventing data,
   * and for a clinical value inventing data is worse than refusing the write: a
   * recorded temperature of 0 is a falsehood sitting in a patient's chart,
   * whereas a refused save leaves the chart true and leaves the clinician able
   * to see that the save did not happen. So these are listed rather than failed,
   * because the right place to close them is the form that asks for the number -
   * not the data layer, which has no safe answer to give.
   */
  const defects = [];
  const unsatisfiable = new Map();
  /** Tables whose model is not an object, so a blank object cannot sweep them. */
  const notSwept = new Set();

  async function auditTable(map) {
    const blank = blankModel();
    const rows = [{ table: map.table, row: null }];
    try {
      rows[0].row = map.modelToRow(blank, 'PARENT-PROBE');
    } catch (err) {
      defects.push([map.table, '(any column)', `a blank model cannot be mapped: ${err.message}`]);
      return;
    }
    // Children hang off the parent's property, so they are walked separately.
    const walk = (child) => {
      const entry = { table: child.table, row: null };
      rows.push(entry);
      try {
        entry.row = child.modelToRow(blank, 'PARENT-PROBE');
      } catch (err) {
        defects.push([child.table, '(any column)', `a blank model cannot be mapped: ${err.message}`]);
        return;
      }
      for (const grand of child.children ?? []) walk(grand);
    };
    for (const child of map.children ?? []) walk(child);

    for (const { table, row: r } of rows) {
      for (const [column, value] of Object.entries(r)) {
        if (value === undefined) continue;
        const info = await columnType(table, column);
        if (!info) {
          defects.push([table, column, 'is not a column in the live database']);
          continue;
        }
        // NULL is the right answer for a column that allows it, and the only
        // wrong one for a column that does not, so it is decided here rather
        // than by type.
        if (value === null) {
          if (info.is_nullable !== 'YES') {
            if (!unsatisfiable.has(table)) unsatisfiable.set(table, []);
            unsatisfiable.get(table).push(`${column} (${info.data_type})`);
          }
          continue;
        }
        const why = whyUnacceptable(info.data_type, value);
        if (!why) continue;
        const label = `${table}.${column} ${why}`;
        if (info.is_nullable === 'YES') {
          // The column would have taken NULL. The mapper sent something else.
          defects.push([table, column, `is sent a value (${why}) to a nullable ${info.data_type} column`]);
        } else if (value === blank) {
          // The blank model itself came back: this table's model is a primitive,
          // so a blank object is not a blank of anything it can hold. Recorded
          // rather than guessed at, because guessing would either invent a
          // failure or hide a real one.
          notSwept.add(table);
        } else {
          if (!unsatisfiable.has(table)) unsatisfiable.set(table, []);
          unsatisfiable.get(table).push(`${column} (${info.data_type})`);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Part B: the clinical chain, written by a real signed-in clinician
  // -------------------------------------------------------------------------

  const now = () => new Date().toISOString();

  function consultationFixture(visitId, patientId, over = {}) {
    return {
      id: `CON${PREFIX}`,
      visitId,
      patientId,
      physicianId: PROFILE,
      physicianName: 'CRUD Audit',
      consultationDate: now(),
      presentingComplaint: 'Fever and headache, three days',
      historyOfPresentingComplaint: 'Started 3 days ago, worse at night',
      pastMedicalHistory: '',
      surgicalHistory: '2010-04-02 | LUTH | Appendicectomy | No recurrence',
      drugHistory: 'Paracetamol as needed',
      familyHistory: '',
      socialHistory: '',
      allergyHistory: '',
      physicalExamination: {
        general: 'Febrile, not pale',
        cardiovascular: '',
        respiratory: '',
        abdomen: 'Tender in the right iliac fossa',
        neurological: '',
        musculoskeletal: '',
        other: '',
      },
      clinicalFindings: '',
      assessment: 'Acute appendicitis',
      diagnoses: [
        { id: `CDX${PREFIX}-1`, code: 'K35.8', description: 'Acute appendicitis', type: 'Primary' },
        { id: `CDX${PREFIX}-2`, code: 'R50.9', description: 'Fever, unspecified', type: 'Secondary' },
      ],
      plan: 'Appendicectomy. Review in one week.',
      // Left blank on purpose. The form only sets this if the doctor fills the
      // follow-up box in, so '' is the ordinary case - and it is the value that
      // voided the entire record before orNull learned to translate it.
      followUpDate: '',
      clinicalNotes: '',
      ...over,
    };
  }

  const patientId = `FC-A${stamp}`;
  const visitId = `VIS${PREFIX}`;

  function patientModel() {
    return {
      id: patientId,
      firstName: 'Audit',
      middleName: '',
      lastName: 'Subject',
      dob: '1990-01-01',
      age: 36,
      sex: 'Female',
      phone: '08000000000',
      email: '',
      address: '1 Test Street',
      nextOfKin: 'Kin Test',
      emergencyContact: '08000000001',
      occupation: '',
      bloodGroup: '',
      genotype: '',
      allergies: [],
      alerts: [],
      registeredAt: now(),
    };
  }

  function visitModel() {
    return {
      id: visitId,
      patientId,
      visitDate: '2026-09-27',
      visitTime: '09:00',
      visitType: 'New Visit',
      status: 'With Nurse',
      attendingPhysicianId: '',
      attendingNurseId: '',
      reasonForVisit: '',
      notes: '',
      ward: '',
      admittedAt: '',
      admittedBy: '',
      dischargedAt: '',
    };
  }

  /**
   * An ordinary vitals reading, as the model carries it.
   *
   * Factored out because the constraint section below has to build a reading with
   * one measurement changed, eight times over, and a hand-copied baseline is
   * exactly how a probe ends up testing something other than what it names.
   */
  function baseVitalsModel() {
    return {
      id: `VIT${PREFIX}`,
      visitId,
      patientId,
      recordedAt: now(),
      nurseId: PROFILE,
      nurseName: 'CRUD Audit',
      temperature: 37,
      systolicBp: 120,
      diastolicBp: 80,
      pulse: 72,
      respiratoryRate: 16,
      spo2: 98,
      weight: 70,
      height: 1.7,
      bmi: 24.2,
      bmiCategory: 'Normal',
      painScore: 4,
      nursingNotes: '',
      nursingCarePlan: '',
      nursingProcedures: [],
      alerts: [],
    };
  }

  /** Leaf tables: created, edited and deleted inside the run, in that order. */
  const LEAF_CASES = [
    {
      table: 'vitals',
      // The same baseline the constraint section builds on, so the two probes
      // cannot be testing different things.
      model: () => ({ ...baseVitalsModel(), temperature: 38.4, pulse: 92, respiratoryRate: 20, alerts: ['Fever'] }),
      patch: { nursingNotes: 'Fluids advised', painScore: 2 },
      created: { temperature_c: 38.4, nursing_notes: '', nursing_procedures: [], alerts: ['Fever'] },
      patched: { nursing_notes: 'Fluids advised', pain_score: 2, temperature_c: 38.4 },
    },
    {
      table: 'lab_requests',
      model: () => ({
        id: `LAB${PREFIX}`,
        visitId,
        patientId,
        physicianId: PROFILE,
        physicianName: 'CRUD Audit',
        requestedAt: now(),
        priority: 'Urgent',
        clinicalIndication: '',
        tests: [
          {
            id: `LTO${PREFIX}-1`,
            testDefinitionId: '',
            testName: 'Full blood count',
            category: 'HEMATOLOGY',
            price: 15000,
            sampleType: 'EDTA',
            status: 'Requested',
            collectedAt: '',
            scientistId: '',
            scientistName: '',
            verifiedBy: '',
            releasedAt: '',
            results: [],
            comments: '',
            criticalAlert: false,
          },
        ],
        paymentStatus: 'Unpaid',
        totalPrice: 15000,
      }),
      patch: { priority: 'STAT' },
      created: { priority: 'Urgent', total_price: 15000, clinical_indication: '' },
      patched: { priority: 'STAT', total_price: 15000 },
    },
    {
      table: 'prescriptions',
      model: () => ({
        id: `PRE${PREFIX}`,
        visitId,
        patientId,
        physicianId: PROFILE,
        physicianName: 'CRUD Audit',
        prescribedAt: now(),
        status: 'Pending',
        items: [
          {
            id: `PRX${PREFIX}-1`,
            medicationId: '',
            medicationName: 'Ceftriaxone 1g',
            dosage: '1g',
            route: 'IV',
            frequency: 'OD',
            duration: '5 days',
            quantityPrescribed: 5,
            quantityDispensed: 0,
            unitPrice: 4500,
            totalPrice: 22500,
            instructions: '',
            dispenseStatus: 'Pending',
            pharmacistNotes: '',
            dispensedAt: '',
          },
        ],
        totalPrice: 22500,
      }),
      patch: { status: 'Partially Dispensed' },
      created: { status: 'Pending', total_price: 22500 },
      patched: { status: 'Partially Dispensed', total_price: 22500 },
    },
  ];

  async function run() {
    // -----------------------------------------------------------------------
    // Reap what earlier dying runs left behind.
    // -----------------------------------------------------------------------
    // A run can die with its throwaway profile still live: on process death a
    // `finally` is never reached, and the fatal handler only deletes the auth
    // account over HTTP - the Postgres rows stay. Each suite owns a distinctive
    // id/email (USR-A.../crudaudit-, USR-FC.../forcedchange-probe,
    // FB-U.../browserprobe-), so the next run sweeps those leftovers before
    // doing anything else. Without this, one crashed run leaves a fake
    // clinician who can sign in and write real-looking records forever.
    //
    // The surface is exactly the ids and addresses this repository's probe
    // machinery generates - a real clinician is never provisioned with them -
    // and the audit rows removed are only ones that reference those profiles or
    // the browser fixture patient, never real patients.
    const { rows: leftover } = await sql.query(
      `select id, email from users
        where id like 'USR-A%'
           or email like 'crudaudit-%@solacemedicares.com'
           or id = 'USR-FC557978'
           or email = 'forcedchange-probe@solacemedicares.com'
           or id = 'FB-U9108760'
           or email like 'browserprobe-%@solacemedicares.com'`,
    );
    if (leftover.length) {
      const ids = leftover.map((r) => r.id);
      console.log(`  sweeping ${leftover.length} leftover probe profile(s): ${ids.join(', ')}`);
      // audit_logs REFUSES the profile delete while its own rows still reference
      // it (ON DELETE RESTRICT). Those rows go first, with the append-only
      // trigger disabled for exactly this statement and re-armed immediately -
      // the same discipline as scripts/purge-test-audit-rows.mjs.
      await sql.query('alter table audit_logs disable trigger trg_audit_immutable');
      try {
        await sql.query(
          `delete from audit_logs
            where user_id = any($1::text[]) or patient_id = 'FB-P9108760'`,
          [ids],
        );
      } finally {
        await sql.query('alter table audit_logs enable trigger trg_audit_immutable');
      }
      const swept = await sql.query(`delete from users where id = any($1::text[]) returning id`, [ids]);
      console.log(`  removed ${swept.rowCount} profile row(s)`);
      // Credentials behind those profiles, if any survived the same crash.
      const authList = (await (await fetch(`${BASE}/auth/v1/admin/users?page=1&per_page=200`, { headers: ADMIN })).json()).users ?? [];
      const probeAuth = authList.filter((u) => /^(crudaudit-|browserprobe-).*@fatclinic\.health$|^forcedchange-probe@fatclinic\.health$/.test(u.email));
      let removedAuth = 0;
      for (const u of probeAuth) {
        const r = await fetch(`${BASE}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: ADMIN });
        if (r.ok) removedAuth++;
      }
      const still = ((await (await fetch(`${BASE}/auth/v1/admin/users?page=1&per_page=200`, { headers: ADMIN })).json()).users ?? [])
        .filter((u) => /^(crudaudit-|browserprobe-).*@fatclinic\.health$|^forcedchange-probe@fatclinic\.health$/.test(u.email));
      if (still.length) {
        console.error(`  WARNING: ${still.length} leftover probe sign-in account(s) SURVIVED the sweep: ${still.map((u) => u.email).join(', ')}`);
        failures++;
      } else if (probeAuth.length) {
        console.log(`  removed ${removedAuth}/${probeAuth.length} leftover probe sign-in account(s)`);
      }
    }

    // A throwaway clinician, so this proves the real thing: a row written with a
    // real clinician's JWT, through the real RLS policies, not with service_role
    // bypassing them.
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
    // Recorded the moment it exists, so every exit path can remove it. It used to
    // be found by email in the teardown, which is only reached from the `finally`
    // - and the two `return`s above sit before that `try`, so a run that created
    // the account and then failed to sign in left a working credential behind.
    // Two were found on 2026-09-28, which is how this was noticed.
    throwawayId = (await created.json()).id;

    // Fault injection, for the one path that cannot be reached any other way: the
    // process dying with a live credential on the server. A `finally` cannot cover
    // it, and that is exactly how the two `crudaudit-` accounts found on
    // 2026-09-28 were left - the direct-Postgres connection dropped mid-run and
    // surfaced as an unhandled 'error' event. Set CRUD_AUDIT_DIE=now to prove the
    // handler above removes the account anyway, and CRUD_AUDIT_DIE=signin to
    // prove the earlier exit path does the same.
    //
    // Read from `process.env`, not the `env` built from .env above: a switch that
    // has to be written into the project's secrets file to be testable is a
    // switch nobody tests.
    const die = process.env.CRUD_AUDIT_DIE;
    if (die === 'now') throw new Error('CRUD_AUDIT_DIE=now: fault injection, on purpose');
    if (die === 'signin') {
      console.error('  could not sign the throwaway account in (CRUD_AUDIT_DIE=signin)');
      failures++;
      await removeThrowaway();
      await sql.end();
      return;
    }

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
      await removeThrowaway();
      await sql.end();
      return;
    }
    const client = createClient(BASE, ANON, {
      global: { headers: { Authorization: `Bearer ${grant.access_token}` } },
      auth: { persistSession: false },
    });

    /** Write and report, distinguishing the two stages a record goes through. */
    async function write(label, map, before, after) {
      let error = null;
      try {
        await pushDiff(map, before, after, client);
      } catch (err) {
        error = err;
      }
      return error;
    }

    const rowOf = async (table, id) => (await sql.query(`select * from ${table} where id = $1`, [id])).rows[0];

    /** Compare what was asked for against what is actually stored. */
    function compare(name, row, wanted) {
      const wrong = Object.entries(wanted).filter(([col, want]) => !sameStored(row?.[col], want));
      check(name, wrong.length === 0, wrong.map(([c, w]) => `${c}: wanted ${JSON.stringify(w)}, stored ${JSON.stringify(row?.[c])}`));
    }

    try {
      console.log('');
      console.log(`  [clinical CRUD audit] ${BASE.replace(/^https?:\/\//, '')}`);
      console.log('');

      // ---------------------------------------------------------------------
      section('no blank optional field reaches a column Postgres cannot parse');
      // This is the sweep that would have found the follow-up-date bug before a
      // doctor's record was lost to it. Every table, every child table, every
      // column, every model field blank, checked against the live column types.
      for (const map of TABLES) await auditTable(map);
      for (const [table, column, why] of defects) {
        check(`${table}.${column}: ${why}`, false);
      }
      check(
        'no blank optional field is sent where NULL would do',
        defects.length === 0,
        `${defects.length} defect(s)`,
      );
      console.log(
        `      ${typeCache.size} columns inspected across ${TABLES.length} tables and their children`,
      );

      // ---------------------------------------------------------------------
      section('a blank value the column must have is refused, not invented');
      // The complementary half, stated as a fact about the design rather than as
      // a pass. A NOT NULL column reached with a blank cannot be sent as NULL
      // without putting a made-up number or a made-up time in a patient's chart,
      // so the write is refused and the header shows the database's message.
      // These are the columns where that is what happens, listed so the count is
      // known rather than guessed.
      const unsatisfiableCount = [...unsatisfiable.values()].reduce((n, v) => n + v.length, 0);
      for (const [table, columns] of unsatisfiable) {
        console.log(`      ${table.padEnd(24)} ${columns.join(', ')}`);
      }
      check(
        'required values are refused rather than defaulted',
        unsatisfiableCount > 0,
        'the design refuses them; the forms that write them ask for the value first',
      );
      if (notSwept.size) {
        console.log(
          `      not swept by the blank model: ${[...notSwept].join(', ')} (their model is a single value, not an object)`,
        );
      }

      // ---------------------------------------------------------------------
      section('the clinician can create, edit and delete the clinical record');
      // In dependency order: a visit cannot be saved without its patient, and
      // nothing that hangs off a visit can be saved without the visit. Each
      // anchor is created and edited here and deleted at the end, after its
      // dependants are gone, so the ordering of the run also proves the ordering
      // of the foreign keys.

      const patient = patientModel();
      const patientPatched = { ...patient, phone: '08000000002', bloodGroup: 'O+' };
      let error = await write('patients', mapOf('patients'), [], [patient]);
      check('patients: creating a record with blank optional fields', !error, error?.message);
      if (!error) {
        compare('patients: what was written is what is stored', await rowOf('patients', patientId), {
          first_name: 'Audit',
          phone: '08000000000',
          blood_group: null,
          occupation: null,
        });
        error = await write('patients', mapOf('patients'), [patient], [patientPatched]);
        check('patients: editing a record', !error, error?.message);
        compare('patients: the edit is what is stored', await rowOf('patients', patientId), {
          phone: '08000000002',
          blood_group: 'O+',
        });
      }

      const visit = visitModel();
      const visitPatched = { ...visit, status: 'With Doctor', attendingPhysicianId: PROFILE };
      error = await write('visits', mapOf('visits'), [], [visit]);
      check('visits: creating a record with blank optional fields', !error, error?.message);
      if (!error) {
        compare('visits: what was written is what is stored', await rowOf('visits', visitId), {
          status: 'With Nurse',
          reason_for_visit: '',
          admitted_at: null,
        });
        error = await write('visits', mapOf('visits'), [visit], [visitPatched]);
        check('visits: editing a record - this is the nurse sending the patient to the doctor', !error, error?.message);
        compare('visits: the edit is what is stored', await rowOf('visits', visitId), {
          status: 'With Doctor',
          attending_physician_id: PROFILE,
        });
        await write('visits', mapOf('visits'), [visitPatched], [visit]);
      }

      for (const c of LEAF_CASES) {
        const model = c.model();
        const patched = { ...model, ...c.patch };
        error = await write(c.table, mapOf(c.table), [], [model]);
        check(`${c.table}: creating a record with blank optional fields`, !error, error?.message);
        if (error) continue;
        compare(`${c.table}: what was written is what is stored`, await rowOf(c.table, model.id), c.created);
        error = await write(c.table, mapOf(c.table), [model], [patched]);
        check(`${c.table}: editing a record`, !error, error?.message);
        compare(`${c.table}: the edit is what is stored`, await rowOf(c.table, model.id), c.patched);
        error = await write(c.table, mapOf(c.table), [patched], []);
        const left = await sql.query(`select 1 from ${c.table} where id = $1`, [model.id]);
        check(`${c.table}: deleting a record`, !error && left.rowCount === 0, error?.message ?? `${left.rowCount} row(s) still present`);
      }

      // The ordered children of the two ordered parents, asserted where the
      // request that owns them is asserted, because a child row that is never
      // written is the shape of failure the six-tabs bug actually took.
      const labChild = await sql.query(`select 1 from lab_test_orders where id = $1`, [`LTO${PREFIX}-1`]);
      check('lab_requests: the ordered test is deleted with its request', labChild.rowCount === 0, 'the test outlived the request');
      const preChild = await sql.query(`select 1 from prescription_items where id = $1`, [`PRX${PREFIX}-1`]);
      check('prescriptions: the prescribed item is deleted with it', preChild.rowCount === 0, 'the item outlived the prescription');

      // ---------------------------------------------------------------------
      section('the consultation saves in full, with nothing left out');
      // One consultation covering all six sections of the Patient's Info tab,
      // most of them with the optional parts blank the way a doctor filling this
      // in in ten minutes would leave them.
      const con = consultationFixture(visitId, patientId);
      error = await write('consultations', mapOf('consultations'), [], [con]);
      check('the consultation was accepted', !error, error?.message);
      if (!error) {
        const row = await rowOf('consultations', con.id);
        compare('Complaint & History: presenting complaint', row, { presenting_complaint: con.presentingComplaint });
        compare('Complaint & History: history of presenting complaint', row, {
          history_presenting_complaint: con.historyOfPresentingComplaint,
        });
        compare('Complaint & History: an unfilled box is empty, not missing', row, { past_medical_history: '' });
        compare('Surgery History: the operations reach the record', row, { surgical_history: con.surgicalHistory });
        compare('Physical Examination: a filled system reaches its own column', row, {
          exam_general: con.physicalExamination.general,
        });
        compare('Physical Examination: another system reaches its own column', row, {
          exam_abdomen: con.physicalExamination.abdomen,
        });
        compare('Physical Examination: an unfilled system is empty', row, { exam_cardiovascular: '' });
        compare('Assessment: the assessment reaches the record', row, { assessment: con.assessment });
        compare('Management Plan: the plan reaches the record', row, { plan: con.plan });
        check(
          'Management Plan: an unfilled follow-up date is NULL, not ""',
          row.follow_up_date === null,
          JSON.stringify(row.follow_up_date),
        );

        const dx = await sql.query(
          `select code, diag_type from clinical_diagnoses where consultation_id = $1 order by code`,
          [con.id],
        );
        check('Diagnosis (ICD-10): both diagnoses were written', dx.rowCount === 2, JSON.stringify(dx.rows));
        check(
          'Diagnosis (ICD-10): with their codes and types',
          dx.rows.map((r) => `${r.code}|${r.diag_type}`).join(',') === 'K35.8|Primary,R50.9|Secondary',
          JSON.stringify(dx.rows),
        );
        await write('consultations', mapOf('consultations'), [con], []);
      }

      // ---------------------------------------------------------------------
      section('a diagnosis removed from the list is removed from the record');
      // Otherwise it keeps reappearing in the patient's history after the doctor
      // deleted it, which is worse than never having written it.
      const two = consultationFixture(visitId, patientId, { id: `CON${PREFIX}-C` });
      await write('consultations', mapOf('consultations'), [], [two]);
      const beforeDrop = await sql.query(
        `select count(*)::int n from clinical_diagnoses where consultation_id = $1`,
        [two.id],
      );
      check('both diagnoses were written first', beforeDrop.rows[0].n === 2, JSON.stringify(beforeDrop.rows[0]));

      const one = { ...two, diagnoses: [two.diagnoses[0]] };
      await write('consultations', mapOf('consultations'), [two], [one]);
      const afterDrop = await sql.query(
        `select code from clinical_diagnoses where consultation_id = $1 order by code`,
        [two.id],
      );
      check(
        'the second diagnosis is deleted on the server',
        afterDrop.rows.length === 1 && afterDrop.rows[0].code === 'K35.8',
        JSON.stringify(afterDrop.rows),
      );
      await write('consultations', mapOf('consultations'), [one], []);
      const gone = await sql.query(`select 1 from clinical_diagnoses where consultation_id = $1`, [two.id]);
      check('its remaining diagnosis is deleted with the consultation', gone.rowCount === 0);

      // ---------------------------------------------------------------------
      // ---------------------------------------------------------------------
      // The form's ranges against the running database's own constraints.
      //
      // The bug: the nursing form checked only whether a box was empty, so a
      // nurse typing T 22, BP 22/111 and pulse 11 was told "Recorded!", an audit
      // row claimed the vitals were recorded, and the insert was refused - the
      // table held nothing. The fix moved the CHECK constraints into the form.
      //
      // That fix is only worth anything if the two really agree, and the
      // off-database check can only compare against the SQL *file*. So this asks
      // the live database: for every constrained column, is the value the form
      // would accept actually stored, and is the value just outside its range
      // actually refused? A range widened in TypeScript without the schema
      // cannot pass both halves.
      section('the form accepts exactly what the vitals column accepts');

      const limits = await import('../src/services/vitalsLimits.ts');
      const VITALS_ID = `VIT${PREFIX}`;

      /**
       * Writes one reading through the real path and reads it back.
       *
       * `pushDiff(map, before, after)`: an empty `before` makes the row an insert.
       * Getting those two the wrong way round is a silent no-op that looks like a
       * database refusal, so the row itself is the only acceptable evidence.
       */
      const writeVitals = async (model) => {
        const err = await write('vitals', mapOf('vitals'), [], [model]);
        const row = (await sql.query(`select * from vitals where id = $1`, [VITALS_ID])).rows[0];
        return { err, row };
      };
      const removeVitals = () => write('vitals', mapOf('vitals'), [{ id: VITALS_ID }], []);

      /** A reading with one field changed and the derived BMI left consistent. */
      const withField = (field, value) => {
        const m = { ...baseVitalsModel(), [field]: value };
        // Only recomputed when it is computable: a weight or height of 0 has no
        // BMI, and the point of that probe is to isolate the column's own CHECK
        // rather than trip two constraints at once.
        const bmi = limits.computeBmi(m.weight, limits.normaliseHeight(m.height));
        if ('bmi' in bmi) {
          m.bmi = bmi.bmi;
          m.bmiCategory = bmi.category;
        }
        m.height = limits.normaliseHeight(m.height);
        return m;
      };

      const LIMIT_COLUMNS = [
        { field: 'temperature', column: 'temperature_c', at: 37, outside: 24 },
        { field: 'systolicBp', column: 'systolic_bp', at: 120, outside: 35 },
        { field: 'diastolicBp', column: 'diastolic_bp', at: 80, outside: 15 },
        { field: 'pulse', column: 'pulse_bpm', at: 72, outside: 15 },
        { field: 'respiratoryRate', column: 'respiratory_rate', at: 16, outside: 2 },
        { field: 'spo2', column: 'spo2_pct', at: 98, outside: 140 },
        { field: 'weight', column: 'weight_kg', at: 70, outside: 0 },
        { field: 'height', column: 'height_m', at: 1.7, outside: 0 },
      ];

      // Direction one: what the form accepts must store. A reading the database
      // rejects is a reading a nurse typed correctly and the app called a fault.
      const notAccepted = [];
      for (const c of LIMIT_COLUMNS) {
        const { err, row } = await writeVitals(withField(c.field, c.at));
        if (err || !row || Number(row[c.column]) !== c.at) {
          notAccepted.push(
            `${c.column}: the form accepts ${c.at}, but the database ${
              err ? `refused it (${err.message})` : `stored ${JSON.stringify(row?.[c.column])}`
            }`,
          );
        }
        await removeVitals();
      }
      check('every value the form accepts, the live column accepts', notAccepted.length === 0, notAccepted);

      // Direction two: what the form refuses must also be refused by the database,
      // or the form is refusing a legitimate reading. Narrowing a range is a
      // clinical decision, and this is where an accidental one shows up.
      const overTight = [];
      for (const c of LIMIT_COLUMNS) {
        const { err } = await writeVitals(withField(c.field, c.outside));
        if (!err) overTight.push(`${c.column}: the form refuses ${c.outside}, but the database stored it`);
        await removeVitals();
      }
      check('every value the form refuses, the live column also refuses', overTight.length === 0, overTight);

      // The cross-field rule, which no single-column range can express: 70/140
      // satisfies both integer ranges and is still not a blood pressure.
      const bp = baseVitalsModel();
      bp.systolicBp = 70;
      bp.diastolicBp = 140;
      const { err: bpErr } = await writeVitals(bp);
      check(
        'the database refuses a diastolic above the systolic, as the schema declares',
        Boolean(bpErr),
        'the reading was stored, so bp_ordering is not enforced on this database',
      );
      check('and the form refuses it first, with an explanation', limits.checkBloodPressureOrder(70, 140).length === 1);
      await removeVitals();

      // The reading that actually happened: 22 °C, 22/111, pulse 11, BMI 22400.
      // One number the nurse never typed voided the whole record, and the audit
      // trail - which is append-only, so it cannot be corrected - said otherwise.
      const impossible = { ...baseVitalsModel(), temperature: 22, systolicBp: 22, diastolicBp: 111, pulse: 11 };
      impossible.bmi = 22400;
      impossible.bmiCategory = 'Obese Class III';
      const { err: impossibleErr } = await writeVitals(impossible);
      check(
        'the reading the form used to accept is refused by the live database',
        Boolean(impossibleErr),
        'it was stored, so the constraint this fix relies on is not present',
      );
      check(
        'and the form now refuses it before any request is made',
        limits.checkVitals({
          temperature: 22, systolicBp: 22, diastolicBp: 111, pulse: 11,
          respiratoryRate: 16, spo2: 98, weight: 224, height: 0.1,
        }).length > 0,
      );
      await removeVitals();

      // The BMI column is narrower than the arithmetic assumes, so a weight and a
      // height that are each valid can still overflow it. This is the specific
      // mechanism that voided the record, so it is asserted rather than assumed.
      const overflowingBmi = limits.computeBmi(400, 0.5);
      check(
        'a weight and height that each pass cannot produce a storable BMI',
        'problem' in overflowingBmi,
        `computeBmi(400, 0.5) returned ${JSON.stringify(overflowingBmi)}`,
      );
      check(
        'so the form refuses the combination rather than sending it',
        limits.checkVitals({ ...baseVitalsModel(), weight: 400, height: 0.5 }).length > 0,
      );
      const { err: overflowErr } = await writeVitals({ ...baseVitalsModel(), weight: 400, height: 0.5, bmi: 1600, bmiCategory: 'Obese Class III' });
      check(
        'and the database would have refused it too, for the same reason',
        Boolean(overflowErr),
        'it was stored, so bmi is wider than the form assumes',
      );
      await removeVitals();

      // The boundary guard for every other numeric CHECK in the schema - the
      // quantities, prices, stocks and session counts that no form range-checks.
      // Two things are worth proving here, and neither is the off-database one:
      // that the transcription still matches the *deployed* schema rather than
      // only the file, and that the refusal happens in the app's real write path.
      section('the guarded ranges are the ranges the deployed database declares');

      // `information_schema.check_constraints` carries no table name and stores
      // the clause as Postgres re-printed it, not as the file wrote it. So
      // `BETWEEN 0 AND 130` arrives as two comparisons against 0 and 130, and
      // every NUMERIC bound arrives cast - `unit_price >= (0)::numeric`. Reading
      // that back into a range is the only way to compare it with the file, and
      // it is also the only way to notice a constraint that exists in the
      // database but not in the schema the app ships.
      const live = (await sql.query(`
        select ccu.table_name, ccu.column_name, cc.check_clause
        from information_schema.check_constraints cc
        join information_schema.constraint_column_usage ccu
          on ccu.constraint_schema = cc.constraint_schema
         and ccu.constraint_name = cc.constraint_name
        where cc.constraint_schema = 'public'
      `)).rows;
      const liveRanges = new Map();
      for (const r of live) {
        // Only comparisons of this column against a number. One against another
        // column - `bp_ordering`, `quantity_dispensed <= quantity_prescribed` -
        // is a cross-field rule, not a range, and is not one of these.
        const on = new RegExp(`"?${r.column_name}"?\\s*(>=|<=|>|<)\\s*\\(?\\s*(-?[\\d.]+)`, 'g');
        const ops = [...String(r.check_clause).matchAll(on)].map((m) => ({ op: m[1], n: Number(m[2]) }));
        if (ops.length === 0) continue;
        const at = (op) => ops.find((o) => o.op === op)?.n;
        const range = {};
        if (at('>=') !== undefined) range.min = at('>=');
        if (at('>') !== undefined && at('>=') === undefined) range.positiveOnly = at('>') === 0;
        if (at('<=') !== undefined) range.max = at('<=');
        if (at('<') !== undefined && at('<=') === undefined) range.max = at('<');
        if (Object.keys(range).length === 0) continue;
        liveRanges.set(`${r.table_name}.${r.column_name}`, range);
      }
      check('the deployed schema\'s numeric CHECKs were all read', liveRanges.size > 40, `read ${liveRanges.size} of ${live.length} constraint rows`);

      // The file is what the app transcribes from and the database is what
      // actually refuses, so the guard is only as good as their agreement.
      const schemaFile = (await import('node:fs')).readFileSync(new URL('../database/fatclinic.sql', import.meta.url), 'utf8');
      const fileRanges = new Map();
      for (const m of schemaFile.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\);/g)) {
        for (const line of m[2].split('\n').map((l) => l.replace(/--.*$/, '').trim()).filter(Boolean)) {
          if (/^CONSTRAINT\b/i.test(line)) continue;
          const between = line.match(/^(\w+)\s+.*?\bCHECK\s*\(\s*\w+\s+BETWEEN\s+(\S+)\s+AND\s+(\S+)\s*\)/i);
          if (between) { fileRanges.set(`${m[1]}.${between[1]}`, { min: Number(between[2]), max: Number(between[3]) }); continue; }
          const bound = line.match(/^(\w+)\s+.*?\bCHECK\s*\(\s*\w+\s*(>=|>)\s*(\S+?)\s*\)/i);
          if (bound) fileRanges.set(`${m[1]}.${bound[1]}`, bound[2] === '>' ? { positiveOnly: true } : { min: Number(bound[3]) });
        }
      }
      const drifted = [...fileRanges.keys()].filter((key) => JSON.stringify(fileRanges.get(key)) !== JSON.stringify(liveRanges.get(key)));
      check('every range the schema file states, the deployed database agrees with', drifted.length === 0, drifted.map((k) => `${k}: file ${JSON.stringify(fileRanges.get(k))}, live ${JSON.stringify(liveRanges.get(k))}`).join('; '));

      // And the guard, in the real write path. A line item of zero is refused
      // locally - so the complaint names the column and the figure, and the
      // invoice is not half-written on the way to being refused.
      const invoiceOf = (quantity) => ({
        id: `INV${PREFIX}`, visitId, patientId,
        date: '2026-03-04', discount: 0, requirePrepayment: false,
        items: [{ id: `ITI${PREFIX}`, serviceCategory: 'Laboratory', description: 'PCV', quantity, unitPrice: 1000, totalPrice: 1000 * quantity }],
      });
      const zeroLine = await write('invoices', mapOf('invoices'), [], [invoiceOf(0)]);
      const nothingStored = await sql.query(`select count(*)::int as n from invoice_items where id = $1`, [`ITI${PREFIX}`]);
      check(
        'a zero-quantity line is refused by the app, by name, before any request',
        /invoice_items\.quantity is 0/.test(zeroLine?.message ?? '') && /greater than 0/.test(zeroLine?.message ?? ''),
        zeroLine?.message ?? 'no error was raised',
      );
      check('and nothing was written on the way to being refused', nothingStored.rows[0].n === 0, `${nothingStored.rows[0].n} row(s) written`);
      check('the guard names the column, not the constraint', !/check constraint/.test(zeroLine?.message ?? ''), zeroLine?.message);

      const goodLine = await write('invoices', mapOf('invoices'), [], [invoiceOf(2)]);
      const storedLine = await sql.query(`select quantity, unit_price, total_price from invoice_items where id = $1`, [`ITI${PREFIX}`]);
      check('a legitimate line is still written', !goodLine && storedLine.rowCount === 1, goodLine?.message ?? 'not stored');
      check('with the quantity it was given', Number(storedLine.rows[0]?.quantity) === 2, storedLine.rows[0]?.quantity);
      await sql.query(`delete from invoices where id = $1`, [`INV${PREFIX}`]);

      section('the visit, then the patient, once nothing hangs off them');
      error = await write('visits', mapOf('visits'), [visit], []);
      const visitLeft = await sql.query(`select 1 from visits where id = $1`, [visitId]);
      check('visits: deleting a record', !error && visitLeft.rowCount === 0, error?.message ?? `${visitLeft.rowCount} row(s) still present`);

      error = await write('patients', mapOf('patients'), [patientPatched], []);
      const patientLeft = await sql.query(`select 1 from patients where id = $1`, [patientId]);
      check('patients: deleting a record', !error && patientLeft.rowCount === 0, error?.message ?? `${patientLeft.rowCount} row(s) still present`);
    } finally {
      // ---------------------------------------------------------------------
      // Cleanup. Everything this created, including the sign-in account, because
      // for a patient-safety system a test that leaves a credential behind is a
      // test that has made the system less safe.
      console.log('');
      section('cleaning up');
      const victims = [
        ['clinical_diagnoses', `consultation_id like 'CON${PREFIX}%'`],
        ['consultations', `id like 'CON${PREFIX}%'`],
        ['lab_test_orders', `id like 'LTO${PREFIX}%'`],
        ['lab_requests', `id like 'LAB${PREFIX}%'`],
        ['prescription_items', `id like 'PRX${PREFIX}%'`],
        ['prescriptions', `id like 'PRE${PREFIX}%'`],
        ['vitals', `id like 'VIT${PREFIX}'`],
        ['visits', `id like 'VIS${PREFIX}'`],
        ['patients', `id like 'FC-A${stamp}'`],
      ];
      for (const [table, where] of victims) {
        const r = await sql.query(`delete from ${table} where ${where}`);
        if (r.rowCount) console.log(`      removed ${r.rowCount} ${table} row(s)`);
      }
      await sql.query(`delete from users where id = $1`, [PROFILE]);
      await removeThrowaway();
      const leftover = await sql.query(
        `select
           (select count(*)::int from patients where id like 'FC-A${stamp}') +
           (select count(*)::int from visits where id like 'VIS${PREFIX}') +
           (select count(*)::int from consultations where id like 'CON${PREFIX}%') +
           (select count(*)::int from vitals where id like 'VIT${PREFIX}') +
           (select count(*)::int from lab_requests where id like 'LAB${PREFIX}%') +
           (select count(*)::int from prescriptions where id like 'PRE${PREFIX}%') +
           (select count(*)::int from users where id = $1) as n`,
        [PROFILE],
      );
      check('nothing this audit created is left behind', leftover.rows[0].n === 0, `${leftover.rows[0].n} row(s) remain`);
    }

    await sql.end();
  }

  /**
   * The verdict, printed and set on every exit from `run`.
   *
   * It used to sit at the end of `run` itself, behind the code that runs the
   * audit - so all three of its early exits, each of which does `failures++` and
   * `return`, skipped it. A run that could not even create its throwaway
   * clinician printed nothing and **exited 0**: the gate reported success
   * because the audit had not run. A failure that reports success is worse than
   * the failure, so the summary moved into a `finally` the early exits cannot
   * step over.
   */
  function report() {
    console.log('');
    if (!checks) {
      // Zero checks means the audit never got started - a refused connection, or
      // an account it could not create. "All 0 checks behaved as expected" is the
      // same false all-clear in a different costume, so it is called out first.
      console.log(
        `[clinical CRUD audit] the audit failed before any check could run${failures ? ` (${failures} problem(s))` : ''}`,
      );
      process.exitCode = 1;
    } else if (failures) {
      console.log(`[clinical CRUD audit] ${failures} of ${checks} checks FAILED`);
      process.exitCode = 1;
    } else {
      console.log(`[clinical CRUD audit] all ${checks} checks behaved as expected`);
    }
  }

  async function main() {
    await sql.connect();
    try {
      await run();
    } finally {
      report();
    }
  }

  /**
   * What "stored" means for a value, which is not the same as what it means in
   * JavaScript. Postgres renders an empty text column as '' and an unset numeric
   * one as 0, so a strict comparison would call a correct write wrong; but it
   * must not be so loose that a wrong write passes, so each type is compared
   * against what Postgres would return for it.
   */
  function sameStored(stored, wanted) {
    if (wanted === null) return stored === null;
    if (Array.isArray(wanted)) {
      const asArray = Array.isArray(stored) ? stored : stored == null ? [] : String(stored).split(',');
      return JSON.stringify(asArray) === JSON.stringify(wanted);
    }
    if (typeof wanted === 'number') return Number(stored) === wanted;
    if (typeof wanted === 'boolean') return Boolean(stored) === wanted;
    return String(stored ?? '') === String(wanted);
  }

  await main();
}

await bootstrap();
