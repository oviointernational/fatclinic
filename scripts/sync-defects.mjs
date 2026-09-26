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
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'src', 'services', 'sync.ts');

/**
 * The pristine source, captured from the file itself at the start of THIS run.
 *
 * Held in memory, deliberately. An earlier version of this script kept the
 * backup in a temp file and only read it, on the assumption that something else
 * refreshed it. Nothing did, so the "backup" froze at whatever sync.ts looked
 * like the first time it ran - and `restore()` then overwrote the real file with
 * that stale copy, silently discarding every edit made since. It cost a set of
 * uncommitted changes to this data layer, which is exactly the kind of loss this
 * suite exists to prevent.
 *
 * Reading the target in-process removes the whole class of problem: there is no
 * second copy to go stale, nothing left behind on disk, and the bytes restored
 * are provably the bytes that were there before the first defect went in.
 */
const ORIGINAL_RAW = fs.readFileSync(TARGET, 'utf8');
// Matching happens on a line-ending-normalised copy, so a snippet written here
// with \n still finds its target in a CRLF source file.
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
  {
    name: 'a staff email is written without normalising its case',
    // The regression this guards is subtle and total: the sign-in lookup is an
    // exact case-insensitive match, RLS resolves the caller with lower(email),
    // and uniqueness is on lower(email). A row stored as typed would be one the
    // clinician can authenticate as but never find, and the app would report
    // "no staff profile" to someone who plainly has one.
    from: "      email: String(m.email ?? '').trim().toLowerCase(),",
    to: '      email: String(m.email ?? \'\').trim(),',
    count: 1,
  },
  {
    name: 'the normaliser is declared but stops normalising',
    // Catches the exemption being claimed without the behaviour. If
    // `normalises: ['email']` can be declared on a mapper that does nothing,
    // the round-trip guarantee silently stops existing for that field.
    from: "    normalises: ['email'],",
    to: '    normalises: [\'name\'],',
    count: 1,
  },
  {
    name: 'a stored password is blanked instead of dropped',
    // The pre-auth shape: `password: ''` on the model. A field that exists but
    // is always empty is one any later screen will happily fill in, and
    // localStorage will then keep the credential.
    from: `      pin: text(r.pin),
      customRoleId: optText(r.custom_role_id),`,
    to: `      pin: text(r.pin),
      password: '',
      customRoleId: optText(r.custom_role_id),`,
    count: 1,
  },
  {
    name: 'the users map is filed under a different key than the one db.ts persists',
    // db.ts persists the staff collection under USERS_STORAGE_KEY and auth.ts
    // looks the mapper up by the same constant, so the two can only disagree if
    // the map is filed under a literal. Then saveStorage finds no map, every
    // staff change is silently never synced, and resolveProfile returns nothing
    // so every sign-in reports "no staff profile" - with the app otherwise
    // looking perfectly healthy.
    from: '    key: USERS_STORAGE_KEY,',
    to: "    key: 'fatclinic_staff',",
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
  // Byte-for-byte, not "close enough". A restore that silently differs - a
  // trimmed newline, a lost BOM - would leave the tree in a state nobody
  // committed, which is how a real edit goes missing without anybody noticing.
  const now = fs.readFileSync(TARGET, 'utf8');
  if (now !== ORIGINAL_RAW) {
    console.error('  [defect injection] FATAL: restore did not reproduce the original bytes.');
    console.error(`    expected ${ORIGINAL_RAW.length} bytes, wrote ${now.length}`);
    process.exit(1);
  }
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
