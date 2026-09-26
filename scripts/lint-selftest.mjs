// Self-test for scripts/lint-schema.mjs: inject known defects and confirm the
// linter reports each one. Proves the linter is not just printing "clean".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const good = fs.readFileSync(path.join(ROOT, 'database', 'fatclinic.sql'), 'utf8');

const linter = path.join(ROOT, 'scripts', 'lint-schema.mjs');
const tmpSql = path.join(ROOT, 'database', '.selftest.sql');
let failures = 0;

async function runLint(file) {
  const { execFileSync } = await import('node:child_process');
  try {
    const out = execFileSync(process.execPath, [linter, file], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}
const cases = [
  {
    name: 'seed key rejected by its own CHECK constraint',
    must: /violates its own CHECK constraint/,
    // LABORATORY.CHEMICAL_PATHOLOGY needs the underscore the constraint allows.
    // Reverting to the original pattern is exactly the bug that was fixed.
    mutate: (s) => s.replace(
      "CHECK (key ~ '^[A-Z][A-Z0-9_]*(\\.[A-Z][A-Z0-9_]*)*$')",
      () => "CHECK (key ~ '^[A-Z][A-Z0-9]*(\\.[A-Z][A-Z0-9]*)*$')",
    ),
  },
  {
    name: 'permission key inserted before its parent',
    must: /is not inserted before it/,
    mutate: (s) => s.replace(
      "('CLINICAL.PHYSICIAN.VIEW', 'CLINICAL.PHYSICIAN',",
      () => "('CLINICAL.PHYSICIAN.VIEW', 'CLINICAL.PHYSICIAN.NOPE',",
    ),
  },
  {
    // A ward code present on only one side breaks admissions: visits.ward is a
    // foreign key to wards(code). The reverse direction (a WARD_OPTIONS code
    // with no seed row) runs the same loop one line further down and is not
    // separately exercised, because the linter reads the real
    // src/types/index.ts.
    name: 'ward code present on only one side',
    must: /absent from WARD_OPTIONS/,
    mutate: (s) => s.replace("('DAY','Day-Care / Observation',15)\n",
      () => "('DAY','Day-Care / Observation',15),\n  ('LONG-STAY','Long Stay',4)\n"),
  },
  {
    name: 'seed names a column the table does not declare',
    must: /INSERT INTO wards names column/,
    mutate: (s) => s.replace('INSERT INTO wards (code, name, capacity)', 'INSERT INTO wards (code, name, capacty)'),
  },
  {
    name: 'foreign key points at a non-existent table',
    must: /REFERENCES patiants/,
    mutate: (s) => s.replace('REFERENCES patients(id) ON DELETE CASCADE', 'REFERENCES patiants(id) ON DELETE CASCADE'),
  },
  {
    name: 'index targets a non-existent table',
    must: /index on patiants/,
    mutate: (s) => s.replace('CREATE INDEX IF NOT EXISTS idx_patients_phone       ON patients(phone);',
      'CREATE INDEX IF NOT EXISTS idx_patients_phone       ON patiants(phone);'),
  },
  {
    name: 'RLS list includes a table that does not exist',
    must: /RLS list staff_tables includes "paitents"/,
    mutate: (s) => s.replace("'wards', 'patients', 'visits'", "'wards', 'paitents', 'visits'"),
  },
  {
    name: 'unclosed function body',
    must: /unbalanced \$\$ delimiters/,
    // Drop the closing delimiter of the first plpgsql body.
    mutate: (s) => s.replace(/END;\r?\n\$\$ LANGUAGE plpgsql;/, 'END;'),
  },
  {
    name: 'unbalanced parentheses',
    must: /unbalanced parentheses/,
    mutate: (s) => s.replace('capacity    INTEGER NOT NULL DEFAULT 0 CHECK (capacity >= 0),',
      'capacity    INTEGER NOT NULL DEFAULT 0 CHECK (capacity >= 0,'),
  },
  {
    name: 'staff password column reintroduced',
    must: /users\.password exists/,
    // NOTE: a function replacer is required here. The replacement text contains
    // "$'", which String.replace would otherwise expand to "rest of string" and
    // silently duplicate the file.
    mutate: (s) => s.replace(
      /(  pin\s+TEXT NOT NULL DEFAULT '1234' CHECK \(pin ~ '\^\[0-9\]\{4\}\$'\),)/,
      (m) => `${m}\n  password             TEXT NOT NULL,`,
    ),
  },
  {
    name: 'view reads a non-existent table',
    must: /view v_currently_admitted reads wardz/,
    // Point an existing view at a table that is not declared anywhere.
    mutate: (s) => s.replace(/LEFT JOIN wards w ON w\.code = v\.ward/,
      () => 'LEFT JOIN wardz w ON w.code = v.ward'),
  },
];

// Control: the real file must pass.
const control = await runLint(path.join(ROOT, 'database', 'fatclinic.sql'));
const controlOk = control.code === 0;
console.log(`  control (unmodified file passes) : ${controlOk ? 'ok' : 'FAILED'}`);
if (!controlOk) {
  console.log(control.out);
  failures++;
}

for (const c of cases) {
  const broken = c.mutate(good);
  if (broken === good) {
    console.log(`  ${c.name.padEnd(46)} : SETUP FAILED (mutation did not apply)`);
    failures++;
    continue;
  }
  fs.writeFileSync(tmpSql, broken);
  const r = await runLint(tmpSql);
  const caught = r.code !== 0 && c.must.test(r.out);
  console.log(`  ${c.name.padEnd(46)} : ${caught ? 'caught' : 'MISSED'}`);
  if (!caught) {
    failures++;
    console.log(r.out.split('\n').slice(0, 12).map(l => `      ${l}`).join('\n'));
  }
}

fs.rmSync(tmpSql, { force: true });

console.log('');
if (failures) {
  console.log(`[lint self-test] ${failures} failure(s)\n`);
  process.exit(1);
}
console.log('[lint self-test] all cases behaved as expected\n');
