// Defect injection for the consultation's own logic, in the same spirit as
// scripts/sync-defects.mjs: each case below breaks one thing, runs the
// self-test, and requires the run to FAIL. A test that cannot detect a
// regression is not a test, and these are the functions a clinician would
// experience as the app losing or misfiling their work rather than as a wrong
// value - the class of failure that is easiest to ship and hardest to notice.
//
// Three files are targeted, so the harness is generalised: the original bytes of
// every target are captured in memory at the start of this run, each defect names
// its own file, and every file is restored and then verified byte-for-byte. A
// restore that silently differs would leave the tree in a state nobody
// committed, which is how a real edit goes missing without anybody noticing.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const TARGETS = {
  access: path.join(ROOT, 'src', 'services', 'consultationAccess.ts'),
  surgery: path.join(ROOT, 'src', 'services', 'surgeryHistory.ts'),
  exam: path.join(ROOT, 'src', 'services', 'physicalExam.ts'),
};

/**
 * The pristine sources, captured from the files themselves at the start of THIS
 * run. Held in memory, deliberately: a temp-file backup froze at whatever the
 * file looked like the first time it ran, and `restore()` then overwrote the real
 * file with that stale copy, silently discarding every edit made since.
 */
const ORIGINAL_RAW = Object.fromEntries(
  Object.entries(TARGETS).map(([k, p]) => [k, fs.readFileSync(p, 'utf8')]),
);
// Matching happens on a line-ending-normalised copy, so a snippet written here
// with \n still finds its target in a CRLF source file.
const ORIGINAL = Object.fromEntries(
  Object.entries(ORIGINAL_RAW).map(([k, v]) => [k, v.replaceAll('\r\n', '\n')]),
);

const DEFECTS = [
  {
    file: 'access',
    name: 'a patient who has not been sent to a doctor becomes writable',
    // The whole point of the gate. A doctor's queue is populated by nurses, and
    // this list is the rule that says whether the patient is in it.
    from: `export const DOCTOR_WRITE_STATUSES: readonly VisitStatus[] = [
  'With Doctor',
  'Awaiting Physician',
  'In Consultation',
  'Awaiting Lab',
  'Awaiting Pharmacy',
  'Awaiting Payment',
  'Admitted',
];`,
    to: `export const DOCTOR_WRITE_STATUSES: readonly VisitStatus[] = [
  'With Doctor',
  'Awaiting Physician',
  'In Consultation',
  'Awaiting Lab',
  'Awaiting Pharmacy',
  'Awaiting Payment',
  'Admitted',
  'With Nurse',
  'Awaiting Vitals',
];`,
    count: 1,
  },
  {
    file: 'access',
    name: 'a closed visit becomes writable',
    // The other direction, and the one a well-meaning "let the doctor amend
    // anything" change would introduce. A visit marked Treated or Discharged is
    // finished; amending it needs a new visit, not an open record.
    from: `  'Awaiting Payment',
  'Admitted',
];`,
    to: `  'Awaiting Payment',
  'Admitted',
  'Treated',
  'Discharged',
  'Completed',
];`,
    count: 1,
  },
  {
    file: 'access',
    name: 'the gate is keyed on presence rather than on the writable list',
    // Inverting the predicate is the mistake that makes everything read-only at
    // once, and it is the natural "simplification" of a two-branch function.
    from: `export function mayDoctorWrite(visit: Visit | null | undefined): boolean {
  return !!visit && DOCTOR_WRITE_STATUSES.includes(visit.status);
}`,
    to: `export function mayDoctorWrite(visit: Visit | null | undefined): boolean {
  return !!visit && !DOCTOR_WRITE_STATUSES.includes(visit.status);
}`,
    count: 1,
  },
  {
    file: 'access',
    name: '"latest visit" is decided by the oldest row instead of the newest',
    // db.getVisits returns newest-first, so `visits[0]` looked correct. Reversing
    // the comparison here leaves the gate deciding on whichever row happens to be
    // first, so a patient whose second visit is still waiting for vitals would be
    // opened on the strength of a visit from months ago.
    from: `  return [...visits].sort(
    (a, b) =>
      new Date(\`\${b.visitDate}T\${b.visitTime || '00:00'}\`).getTime() -
      new Date(\`\${a.visitDate}T\${a.visitTime || '00:00'}\`).getTime(),
  )[0];`,
    to: `  return [...visits].sort(
    (a, b) =>
      new Date(\`\${a.visitDate}T\${a.visitTime || '00:00'}\`).getTime() -
      new Date(\`\${b.visitDate}T\${b.visitTime || '00:00'}\`).getTime(),
  )[0];`,
    count: 1,
  },
  {
    file: 'access',
    name: 'a read-only visit gives no reason at all',
    // The doctor is left looking at a screen full of empty boxes with a greyed
    // out button, which reads as a broken app rather than as "wait for nursing".
    from: `  if (mayDoctorWrite(visit)) return null;`,
    to: `  if (mayDoctorWrite(visit)) return null;
  if (visit) return null;`,
    count: 1,
  },
  {
    file: 'exam',
    name: 'the examination columns are matched by substring again',
    // The original bug, verbatim. "Gastrointestinal" contains no "gi" and no
    // "abdomen"; "Neurological" contains no "nervous" and no "cns". Both fell
    // through to the else branch, so an abdominal and a neurological examination
    // both arrived in the record as "Other Systems / Findings" while the screen
    // the doctor was looking at said gastrointestinal and neurological.
    from: `  const system = lower.split(' - ')[0].trim();
  const direct = SYSTEM_TO_COLUMN[system];
  if (direct) return direct;`,
    to: `  const system = lower.split(' - ')[0].trim();
  void system;
  const k0 = lower;
  if (k0.includes('general')) return 'general';
  if (k0.includes('cardio')) return 'cardiovascular';
  if (k0.includes('resp')) return 'respiratory';
  if (k0.includes('abdomen') || k0.includes('gi')) return 'abdomen';
  if (k0.includes('nervous') || k0.includes('cns')) return 'neurological';
  if (k0.includes('musculo')) return 'musculoskeletal';`,
    count: 1,
  },
  {
    file: 'exam',
    name: 'an entry naming no system is misfiled instead of kept under "other"',
    // "Other" is a real answer: an entry whose title the dialog could not have
    // produced still has to be saved somewhere. Sending it to a real system column
    // puts a finding on a body system nobody examined.
    from: "  return 'other';\n}",
    to: "  return 'general';\n}",
    count: 1,
  },
  {
    file: 'exam',
    name: 'the additional-findings entry is treated as a system again',
    // It has its own column, clinicalFindings, and it used to be appended to
    // "other" as well, so the same text was written to two columns on every save.
    from: "export function isAdditionalFindings(title: string): boolean {\n  return title.toLowerCase().includes('additional');\n}",
    to: "export function isAdditionalFindings(title: string): boolean {\n  return false;\n}",
    count: 1,
  },
  {
    file: 'surgery',
    name: 'the Surgery History entries are never written to the column',
    // The original bug, verbatim: the tab kept its entries in React state that
    // handleSaveConsultation never read, so every operation recorded there was
    // discarded on save while the form said "Saved!".
    from: 'export function formatSurgeryHistory(entries: SurgeryHistoryEntry[]): string {\n  return entries',
    to: 'export function formatSurgeryHistory(entries: SurgeryHistoryEntry[]): string {\n  if (entries.length) return \'\';\n  return entries',
    count: 1,
  },
  {
    file: 'surgery',
    name: 'the surgery list is split on every separator, cutting notes in half',
    // Notes are free text written by a clinician, and a BMI series reads
    // "42 | 38 | 36". Splitting on every pipe keeps the first piece and loses
    // the rest of the note.
    from: '        notes: parts.slice(3).join(FIELD).trim(),',
    to: '        notes: (parts[3] ?? \'\').trim(),',
    count: 1,
  },
  {
    file: 'surgery',
    name: 'a line this module did not write is thrown away',
    // The same column is reachable as free text from the Complaint & History
    // tab, so a line the parser does not understand is still text a clinician
    // typed and must survive a round trip.
    from: `        out.push({ id: \`surg-\${index + 1}\`, date: '', hospital: '', surgeryType: line, notes: '' });`,
    to: '        void index;',
    count: 1,
  },
  {
    file: 'surgery',
    name: 'a line is trimmed before it is split, losing its field positions',
    // A surgery recorded without a date serialises as " |  | Appendicectomy | ".
    // Trimming the line turns the leading empty date into a bare "|" that the
    // separator no longer matches, so the entry comes back as one unrecognised
    // line with the separators still in its text - and re-saving writes them back.
    from: '    .filter((line) => line.trim() !== \'\')\n    .forEach((line, index) => {',
    to: '    .map((line) => line.trim())\n    .filter((line) => line !== \'\')\n    .forEach((line, index) => {',
    count: 1,
  },
];

function restore() {
  for (const [k, p] of Object.entries(TARGETS)) {
    fs.writeFileSync(p, ORIGINAL_RAW[k], 'utf8');
    const now = fs.readFileSync(p, 'utf8');
    if (now !== ORIGINAL_RAW[k]) {
      console.error('  [defect injection] FATAL: restore did not reproduce the original bytes.');
      console.error(`  ${path.basename(p)}: expected ${ORIGINAL_RAW[k].length} bytes, wrote ${now.length}`);
      process.exit(1);
    }
  }
}

function run() {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'consultation-selftest.mjs')], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out };
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

let survived = 0;

console.log('');
console.log('  Injecting defects into the consultation logic');
console.log('');
console.log('  A defect that does NOT fail the self-test is a gap in the suite.');
console.log('');

for (const defect of DEFECTS) {
  restore();
  const source = ORIGINAL[defect.file];
  const occurrences = source.split(defect.from).length - 1;
  if (occurrences !== defect.count) {
    console.log(`  ${defect.name}`);
    console.log(`      SKIPPED - the snippet matched ${occurrences} time(s), expected ${defect.count}.`);
    console.log(`      The source has moved; this case is testing nothing. Update it.`);
    survived++;
    continue;
  }
  fs.writeFileSync(TARGETS[defect.file], source.replaceAll(defect.from, defect.to), 'utf8');
  const result = run();
  const failing = result.out
    .split('\n')
    .filter((line) => line.includes('FAILED'))
    .map((line) => line.trim().split(/\s{2,}/)[0]);

  console.log(`  ${defect.name}`);
  if (result.ok) {
    console.log('      NOT DETECTED - the self-test still passed.');
    survived++;
  } else if (failing.length) {
    console.log(`      detected: ${failing.length} check(s) failed`);
    for (const line of failing.slice(0, 3)) console.log(`        - ${line}`);
  } else {
    const cause = result.out.split('\n').find((l) => /Error|error:/i.test(l))?.trim() ?? 'unknown';
    console.log(`      detected: the run aborted - ${cause.slice(0, 110)}`);
  }
}

restore();

// The restore itself has to be verified, or a green result here means nothing.
const final = run();
if (final.ok) {
  const total = final.out.match(/all (\d+) checks/)?.[1];
  console.log('');
  console.log(`  [defect injection] every defect was caught; originals restored, ${total} checks pass`);
} else {
  console.log('');
  console.log('  [defect injection] FAILED to restore: the self-test fails on the pristine files.');
  process.exitCode = 1;
}

if (survived) {
  console.log(`  [defect injection] ${survived} defect(s) slipped through`);
  process.exitCode = 1;
}
console.log('');
