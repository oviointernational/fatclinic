/**
 * Give every laboratory investigation a real analyte panel, in the live database.
 *
 * THE DEFECT THIS EXISTS TO END
 * -----------------------------
 * A Full Blood Count is sixteen analytes. It was being recorded in one free-text
 * box, and the cause was not the screen: `lab_parameters` held no rows for it at
 * all. Nine investigations had panels in this database and five did not, because
 * nine were seeded from a browser's copy of the catalogue (src/services/seedData.ts)
 * and five from database/fatclinic.sql, and where both claimed the same id the
 * first to arrive won. FBC was in the database with no panel, and its panel was in
 * a JavaScript bundle.
 *
 * An empty panel is invisible. No error, no rejected row, a clean "Result Entered" -
 * and a result recorded in one box that is then released to a physician as though
 * one number were a full blood count.
 *
 * WHAT IT DOES, IN ORDER
 * ----------------------
 *   1. Adds the three columns the panel needs: `sort_order` (a report that lists its
 *      analytes in whatever order the database returned is not a report), and
 *      `ref_low` / `ref_high` (the bounds a value is compared against to decide
 *      Normal, Low or High - which the printed range cannot supply, being prose for
 *      a non-numeric analyte and sex-specific text for a numeric one).
 *   2. Renames the 33 existing analyte ids from `p_alb` to `LAB-CHE-01.p_alb`.
 *      `lab_parameters.id` is the primary key, so a bare id could belong to exactly
 *      one investigation - which would mean serum creatinine could not appear on
 *      both the renal profile and the electrolytes panel. Existing results are
 *      repointed first, and there are none today, but a device holding this
 *      database's schema must not have to care.
 *   3. Inserts the seed's missing panels, and brings the existing 33 rows onto the
 *      seed's values.
 *   4. Revokes INSERT / UPDATE / DELETE on `lab_parameters` from `authenticated`.
 *      Reading the panel is how a result is entered, so SELECT stays; writing it is
 *      not something any screen does, and a browser's stale copy re-pushing it over
 *      a parent's change is how a panel silently loses analytes.
 *
 * WHY IT UPDATES EXISTING ROWS WHEN THE SEED DOES NOT
 * --------------------------------------------------
 * `ON CONFLICT (id) DO NOTHING` is right for a seed: it states the catalogue without
 * overwriting a price somebody has set. It is wrong for adding a column to a table
 * that already holds rows, because every existing row comes back with `sort_order`
 * defaulting to 100, no bounds at all, and a range that cannot be read - so nine
 * panels would be present and none of them would flag anything. This is the
 * one-off that gives those rows the new columns' values, and it reports every row
 * it touches, before and after.
 *
 * Nothing clinical is overwritten: the values it writes are the ones the seed
 * declares, and where a row already agrees it is left alone.
 *
 * Run:  node scripts/migrate-lab-panels.mjs --dry-run   (report, change nothing)
 *       node scripts/migrate-lab-panels.mjs              (apply)
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { readCatalogueSeed } from './lab-catalogue-seed.mjs';

const dryRun = process.argv.includes('--dry-run');
const verbose = process.argv.includes('--why');

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

const catalogue = readCatalogueSeed(readFileSync(new URL('../database/fatclinic.sql', import.meta.url), 'utf8'));

const db = new pg.Client({
  host: env.PGHOST,
  port: Number(env.PGPORT),
  user: env.PGUSER,
  password: env.PGPASSWORD,
  database: env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const say = (line) => console.log(line);
const head = (line) => console.log(`\n${line}`);

if (dryRun) {
  head('[migrate-lab-panels] DRY RUN - nothing will be written. Re-run without --dry-run to apply.');
}

await db.query('BEGIN');
try {
  // --- 1. the columns the panel needs ---------------------------------------
  head('[migrate-lab-panels] 1. columns');
  const added = [];
  for (const ddl of [
    'ALTER TABLE public.lab_parameters ADD COLUMN IF NOT EXISTS ref_low NUMERIC',
    'ALTER TABLE public.lab_parameters ADD COLUMN IF NOT EXISTS ref_high NUMERIC',
    'ALTER TABLE public.lab_parameters ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 100',
  ]) {
    const { rows } = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'lab_parameters' AND column_name = $1`, [
      ddl.includes('ref_low') ? 'ref_low' : ddl.includes('ref_high') ? 'ref_high' : 'sort_order',
    ]);
    if (rows.length === 0) {
      added.push(ddl.split('ADD COLUMN IF NOT EXISTS ')[1].split(' ')[0]);
      if (!dryRun) await db.query(ddl);
    }
  }
  say(added.length
    ? `  adding: ${added.join(', ')}`
    : '  ref_low, ref_high and sort_order are all present');

  // --- 2. namespace the existing analyte ids --------------------------------
  head('[migrate-lab-panels] 2. analyte ids');
  // A namespaced id is `<investigation id>.<analyte key>`, and the dot is the only
  // marker: the investigation id itself contains a HYPHEN (`LAB-CHE-01`), so a
  // test written as `NOT LIKE 'LAB\_%'` reads an already-namespaced id as bare and
  // prefixes it a second time on the next run. Testing for the separator is what
  // makes this script safe to re-run, which it has to be.
  const bare = await db.query(
    `SELECT id, investigation_id FROM public.lab_parameters
      WHERE id NOT LIKE '%.%'
      ORDER BY investigation_id, id`,
  );
  if (bare.rows.length === 0) {
    say('  every analyte id is already namespaced');
  } else {
    // Results first, in the same transaction as the rename below: lab_results.parameter_id
    // is deliberately not a foreign key, so nothing would stop it being left pointing
    // at an id that no longer exists - a result row that names an analyte the panel
    // does not have, which is exactly the kind of record that is worthless and
    // invisible.
    const repointed = await db.query(
      `UPDATE public.lab_results r SET parameter_id = p.investigation_id || '.' || r.parameter_id
         FROM public.lab_parameters p
        WHERE p.id = r.parameter_id AND p.id NOT LIKE '%.%'
        RETURNING r.id`,
    );
    say(
      repointed.rowCount > 0
        ? `  repointing ${repointed.rowCount} existing result(s) at the renamed analytes`
        : '  no recorded result points at an id that is about to change',
    );
    say(`  renaming ${bare.rows.length} analyte id(s), e.g. ${bare.rows[0].investigation_id}.${bare.rows[0].id}`);
    if (!dryRun) {
      await db.query(
        `UPDATE public.lab_parameters SET id = investigation_id || '.' || id
          WHERE id NOT LIKE '%.%'`,
      );
    }
  }

  // --- 3. the investigations and panels the seed declares --------------------
  head('[migrate-lab-panels] 3. catalogue and panels');
  const existing = await db.query('SELECT id, code, name FROM public.lab_investigations ORDER BY id');
  const known = new Map(existing.rows.map((r) => [r.id, r]));
  let investigationsAdded = 0;

  for (const inv of catalogue) {
    if (known.has(inv.id)) continue;
    investigationsAdded += 1;
    say(`  adding investigation ${inv.code} - ${inv.name}`);
    if (!dryRun) {
      await db.query(
        `INSERT INTO public.lab_investigations (id, code, name, category, price, sample_type, turnaround_time, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [inv.id, inv.code, inv.name, inv.category, inv.price, inv.sampleType, inv.turnaroundTime, inv.description || null],
      );
    }
  }
  if (investigationsAdded === 0) say('  every seeded investigation is already in the catalogue');

  const present = await db.query('SELECT * FROM public.lab_parameters');
  // Indexed under the id it will have once step 2 has run, so a dry run compares
  // the seed against the rows the migration will actually find. Without that, a dry
  // run reports 33 analytes to add and none to update, when the truth is that 33
  // are there and all 33 need the new columns - which is the whole point of this
  // script, and the part a reviewer most needs to see.
  const byId = new Map();
  for (const r of present.rows) {
    byId.set(r.id, r);
    if (!r.id.includes('.')) byId.set(`${r.investigation_id}.${r.id}`, r);
  }
  let inserted = 0;
  let updated = 0;
  const changed = [];

  for (const inv of catalogue) {
    for (const p of inv.parameters) {
      const row = byId.get(p.id);
      if (!row) {
        inserted += 1;
        if (verbose) say(`  + ${p.id}  ${p.name}`);
        if (!dryRun) {
          await db.query(
            `INSERT INTO public.lab_parameters
               (id, investigation_id, name, unit, reference_range, ref_low, ref_high, sort_order, result_type, options)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (id) DO NOTHING`,
            [p.id, inv.id, p.name, p.unit, p.referenceRange, p.refLow, p.refHigh, p.sortOrder, p.resultType, p.options],
          );
        }
        continue;
      }
      const same =
        row.name === p.name &&
        row.unit === p.unit &&
        row.reference_range === p.referenceRange &&
        (row.ref_low === null ? null : Number(row.ref_low)) === p.refLow &&
        (row.ref_high === null ? null : Number(row.ref_high)) === p.refHigh &&
        Number(row.sort_order) === p.sortOrder &&
        row.result_type === p.resultType &&
        JSON.stringify(row.options ?? []) === JSON.stringify(p.options);
      if (same) continue;
      updated += 1;
      const differences = [];
      if (row.name !== p.name) differences.push(`name ${row.name} -> ${p.name}`);
      if (row.unit !== p.unit) differences.push(`unit ${row.unit} -> ${p.unit}`);
      if (row.reference_range !== p.referenceRange) differences.push(`range ${row.reference_range} -> ${p.referenceRange}`);
      if ((row.ref_low === null ? null : Number(row.ref_low)) !== p.refLow || (row.ref_high === null ? null : Number(row.ref_high)) !== p.refHigh) {
        differences.push(`bounds ${row.ref_low}..${row.ref_high} -> ${p.refLow}..${p.refHigh}`);
      }
      if (Number(row.sort_order) !== p.sortOrder) differences.push(`order ${row.sort_order} -> ${p.sortOrder}`);
      if (row.result_type !== p.resultType) differences.push(`type ${row.result_type} -> ${p.resultType}`);
      if (JSON.stringify(row.options ?? []) !== JSON.stringify(p.options)) {
        differences.push(`options [${row.options ?? []}] -> [${p.options}]`);
      }
      changed.push(`  ~ ${p.id}  ${differences.join('; ')}`);
      if (!dryRun) {
        await db.query(
          `UPDATE public.lab_parameters
              SET name = $2, unit = $3, reference_range = $4, ref_low = $5, ref_high = $6,
                  sort_order = $7, result_type = $8, options = $9
            WHERE id = $1`,
          [p.id, p.name, p.unit, p.referenceRange, p.refLow, p.refHigh, p.sortOrder, p.resultType, p.options],
        );
      }
    }
  }

  say(`  ${inserted} analyte(s) added, ${updated} brought onto the seed's values, ${present.rows.length} were there`);
  for (const line of changed) say(line);

  // --- 4. take the panel off the clients ------------------------------------
  head('[migrate-lab-panels] 4. client write access');
  // The panel is the laboratory's reference data: what a blood count reports and
  // the interval each analyte is judged against. No screen edits it, so every write
  // the app ever made came from a copy held in a browser, and that copy goes stale
  // the moment the catalogue changes - a parent write re-pushes the whole nested
  // array, so an administrator correcting a price on an old laptop would delete the
  // analytes this script just added and put the old ones back, with no error. The
  // REVOKE in database/fatclinic.sql states this for a fresh install; it is
  // repeated here because this is what actually reaches a database created before
  // the line existed. SELECT is untouched, so a scientist can still read the panel
  // to enter a result against it, and `service_role` keeps its own grants - which is
  // how the panel above was just written.
  if (!dryRun) {
    await db.query('REVOKE INSERT, UPDATE, DELETE ON TABLE public.lab_parameters FROM authenticated');
  }
  say('  clients may read the panel and may not write it (INSERT/UPDATE/DELETE revoked)');

  // --- 5. what the database says afterwards ---------------------------------
  head('[migrate-lab-panels] after');
  const panel = await db.query(
    `SELECT i.id, i.code, i.name, count(p.id)::int AS analytes
       FROM public.lab_investigations i
       LEFT JOIN public.lab_parameters p ON p.investigation_id = i.id
      GROUP BY i.id, i.code, i.name
      ORDER BY i.category, i.id`,
  );
  for (const row of panel.rows) {
    say(`  ${row.analytes === 0 ? '!!' : '  '} ${row.code.padEnd(11)} ${String(row.analytes).padStart(2)} analytes  ${row.name}`);
  }
  const bare2 = await db.query(
    `SELECT count(*)::int AS n FROM public.lab_parameters WHERE id NOT LIKE '%.%'`,
  );
  const misfiled = await db.query(
    `SELECT count(*)::int AS n FROM public.lab_parameters WHERE id NOT LIKE investigation_id || '.%'`,
  );
  say(`  ${panel.rows.length} investigations, ${panel.rows.reduce((n, r) => n + r.analytes, 0)} analytes, ${bare2.rows[0].n} un-namespaced, ${misfiled.rows[0].n} on the wrong panel`);

  if (dryRun) {
    await db.query('ROLLBACK');
    head('[migrate-lab-panels] DRY RUN - rolled back. Nothing was written.');
  } else {
    await db.query('COMMIT');
    head('[migrate-lab-panels] committed. Run: npm run db:check-lab-catalogue');
  }
} catch (err) {
  await db.query('ROLLBACK').catch(() => {});
  console.error(`\n[migrate-lab-panels] failed, rolled back: ${err.message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
