// Defect injection: prove scripts/sync-selftest.mjs actually fails when the sync
// layer is broken. A test that cannot detect a regression is not a test, and
// for a medical-records data layer "it passed" is not evidence of correctness.
//
// Each case below breaks one thing in src/services/sync.ts, runs the self-test,
// and requires the run to FAIL. The original file is restored afterwards, and
// the final run is required to PASS, which also proves the restore worked.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'src', 'services', 'sync.ts');
const BACKUP = path.join(os.tmpdir(), 'sync.ts.bak');
// Restored byte for byte. Matching happens on a line-ending-normalised copy, so
// a snippet written here with \n still finds its target in a CRLF source file.
const ORIGINAL_RAW = fs.readFileSync(BACKUP, 'utf8');
const ORIGINAL = ORIGINAL_RAW.replaceAll('\r\n', '\n');

const DEFECTS = [
  {
    name: 'an empty string is sent instead of NULL for a foreign key',
    // The bug the suite was built for: '' is a real value, and a foreign key
    // check against it fails, so a consultation with no physician cannot save.
    from: `        patient_id: m.patientId,
        physician_id: fk(m.physicianId),
        physician_name: m.physicianName ?? '',`,
    to: `        patient_id: m.patientId,
        physician_id: orNull(m.physicianId),
        physician_name: m.physicianName ?? '',`,
    count: 1,
  },
  {
    name: 'the single-row tables stop sending their primary key',
    // id is a PRIMARY KEY with no DEFAULT and a CHECK pinning it to 1, so an
    // upsert without it violates NOT NULL.
    from: `    single: true,
    // id is sent, not omitted: it is a PRIMARY KEY with no DEFAULT and a CHECK
    // that pins it to 1, so a row without it violates NOT NULL on insert.
    omit: SERVER_MANAGED,`,
    to: `    single: true,
    omit: [...SERVER_MANAGED, 'id'],`,
    count: 2,
  },
  {
    name: 'the invoice settle pass also runs on insert',
    // Not a data-corruption bug, but an extra request per new invoice. The
    // assertion pins the intended efficiency.
    from: '  const settleFor = touched.filter((t) => !t.isNew);',
    to: '  const settleFor = touched;',
    count: 1,
  },
  {
    name: 'a cleared grandchild row is left behind',
    // The delete key is built from the prior state; handing it the new state
    // produces undefined and the row silently stays on the server.
    from: '        before?.[child.property],',
    to: '        undefined,',
    count: 1,
  },
  {
    name: 'the append-only guard is removed',
    // audit_logs has no UPDATE policy and a trigger that raises, so this would
    // make the second save of an audit entry fail outright.
    from: '  if (map.appendOnly) {',
    to: '  if (false) {',
    count: 1,
  },
  {
    name: 'the database-owned money columns are sent by the client',
    // The client and the trigger would both compute the totals, and whichever
    // lost would silently change what a patient is billed.
    from: "    dbOwned: ['subtotal', 'total', 'paid_amount', 'balance', 'payment_status'],",
    to: '    dbOwned: [],',
    count: 1,
  },
];

function run() {
  try {
    const out = execFileSync(process.execPath, ['scripts/sync-selftest.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out };
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

function restore() {
  fs.writeFileSync(TARGET, ORIGINAL_RAW, 'utf8');
}

let survived = 0;

console.log('');
console.log('  Injecting defects into src/services/sync.ts');
console.log('');
console.log('  A defect that does NOT fail the self-test is a gap in the suite.');
console.log('');

for (const defect of DEFECTS) {
  restore();
  const source = ORIGINAL;
  const occurrences = source.split(defect.from).length - 1;
  if (occurrences !== defect.count) {
    console.log(`  ${defect.name}`);
    console.log(`      SKIPPED - the snippet appears ${occurrences} time(s), expected ${defect.count}`);
    console.log('      The self-test file and sync.ts have drifted apart. Fix the snippet.');
    survived++;
    continue;
  }

  fs.writeFileSync(TARGET, source.replaceAll(defect.from, defect.to), 'utf8');
  const result = run();
  const failing = result.out
    .split('\n')
    .filter((line) => line.includes('FAILED'))
    .map((line) => line.trim().split(/\s{2,}/)[0]);

  if (result.ok) {
    console.log(`  ${defect.name}`);
    console.log('      NOT DETECTED - the self-test still passed.');
    survived++;
  } else {
    console.log(`  ${defect.name}`);
    if (failing.length) {
      console.log(`      detected: ${failing.length} check(s) failed`);
      for (const line of failing.slice(0, 3)) console.log(`        - ${line}`);
    } else {
      // A defect can also be caught by the run aborting, which is what happens
      // when the fake server's foreign key check throws. That is a detection,
      // and an ugly one: the suite stops rather than reporting a failed check.
      const cause =
        result.out.split('\n').find((l) => /Error|error:/i.test(l))?.trim() ?? 'unknown';
      console.log(`      detected: the run aborted - ${cause.slice(0, 110)}`);
    }
  }
}

restore();

// The restore itself has to be verified, or a green result here means nothing.
const final = run();
if (final.ok) {
  const total = final.out.match(/all (\d+) checks/)?.[1];
  console.log('');
  console.log(`  [defect injection] every defect was caught; original restored, ${total} checks pass`);
} else {
  console.log('');
  console.log('  [defect injection] FAILED to restore: the self-test fails on the pristine file.');
  process.exitCode = 1;
}

if (survived) {
  console.log(`  [defect injection] ${survived} defect(s) slipped through`);
  process.exitCode = 1;
}
console.log('');
