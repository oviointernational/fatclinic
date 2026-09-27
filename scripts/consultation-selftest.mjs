// Self-test for the consultation's own logic: when a doctor may write, which
// examination column a finding belongs in, and how the Surgery History tab
// survives the single text column it has to live in.
//
// All three are pure functions, and all three were wrong in ways a clinician
// would have experienced as the app losing their work rather than as a wrong
// value:
//
//   - the write gate existed only as a filter on the patient list, so the
//     consultation form itself was fully editable for a patient no nurse had
//     sent, and the rule was written out four times with the copies drifting;
//   - the examination mapper matched column names by substring, so the
//     Gastrointestinal and Neurological systems the dialog offers - the two whose
//     names contain none of the substrings it looked for - were filed under
//     "other";
//   - the Surgery History tab wrote to React state that `handleSaveConsultation`
//     never read, so every operation recorded there was discarded on save.
//
// A test that cannot detect a regression is not a test, so
// scripts/consultation-defects.mjs breaks each of these on purpose and requires
// this file to fail.
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const fromDir = context.parentURL
        ? path.dirname(fileURLToPath(context.parentURL))
        : ROOT;
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

const {
  DOCTOR_WRITE_STATUSES,
  mayDoctorWrite,
  readOnlyReason,
  isWithDoctor,
  latestVisit,
} = await import('../src/services/consultationAccess.ts');
const {
  formatSurgeryHistory,
  parseSurgeryHistory,
  isStructuredSurgeryHistory,
} = await import('../src/services/surgeryHistory.ts');
const { classifyExamEntry, isAdditionalFindings } = await import('../src/services/physicalExam.ts');

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let failures = 0;
let checks = 0;

function check(name, ok, detail) {
  checks++;
  if (ok) {
    console.log(`  ${name.padEnd(62)} : ok`);
  } else {
    failures++;
    console.log(`  ${name.padEnd(62)} : FAILED`);
    if (detail !== undefined) {
      for (const line of [].concat(detail)) console.log(`      ${line}`);
    }
  }
}

function section(title) {
  console.log('');
  console.log(`  ${title}`);
}

const visit = (status, over = {}) => ({
  id: over.id ?? `V-${status}`,
  patientId: 'P-1',
  visitDate: over.visitDate ?? '2026-09-27',
  visitTime: over.visitTime ?? '09:00',
  visitType: 'New Visit',
  status,
  ...over,
});

/** Every status the schema's Visit type allows. */
const ALL_STATUSES = [
  'Awaiting Vitals',
  'With Nurse',
  'Awaiting Physician',
  'With Doctor',
  'In Consultation',
  'Awaiting Lab',
  'Awaiting Pharmacy',
  'Awaiting Payment',
  'Admitted',
  'Treated',
  'Discharged',
  'Completed',
];

// ---------------------------------------------------------------------------
// 1. The gate: a doctor may only write once a nurse has sent the patient
// ---------------------------------------------------------------------------

section('a doctor may not write before a nurse has sent the patient');
for (const status of ['Awaiting Vitals', 'With Nurse']) {
  check(`${status} is read-only`, mayDoctorWrite(visit(status)) === false);
  check(
    `${status} says the patient has not been sent yet`,
    /not been sent to a doctor/.test(readOnlyReason(visit(status)) ?? ''),
    readOnlyReason(visit(status)),
  );
}

section('a doctor may write once the patient has reached them');
for (const status of ['With Doctor', 'Awaiting Physician', 'In Consultation']) {
  check(`${status} is writable`, mayDoctorWrite(visit(status)) === true, readOnlyReason(visit(status)));
}

section('a closed visit is read-only, and says so differently');
for (const status of ['Treated', 'Discharged', 'Completed']) {
  check(`${status} is read-only`, mayDoctorWrite(visit(status)) === false);
  check(
    `${status} says the visit is closed`,
    /closed/.test(readOnlyReason(visit(status)) ?? ''),
    readOnlyReason(visit(status)),
  );
}

section('a doctor may still amend what they wrote before the visit moved on');
// The prescription corrected after the pharmacy has been asked for it is the
// ordinary case, not an exception. If these were read-only a clinical error could
// only be fixed by reopening a visit nobody can reopen.
for (const status of ['Awaiting Lab', 'Awaiting Pharmacy', 'Awaiting Payment', 'Admitted']) {
  check(`${status} is still writable`, mayDoctorWrite(visit(status)) === true, readOnlyReason(visit(status)));
}

section('the gate is total: every status is either writable or explained');
for (const status of ALL_STATUSES) {
  const v = visit(status);
  const writable = mayDoctorWrite(v);
  const reason = readOnlyReason(v);
  check(
    `${status} is decided one way or the other`,
    writable ? reason === null : typeof reason === 'string' && reason.length > 20,
    reason ?? 'writable but a reason was given',
  );
}

section('the gate has no third state');
check('no visit selected is not writable', mayDoctorWrite(undefined) === false);
check('no visit selected explains itself', /No visit is selected/.test(readOnlyReason(undefined) ?? ''), readOnlyReason(undefined));
check('null is not writable', mayDoctorWrite(null) === false);
check('the writable list has no duplicates', new Set(DOCTOR_WRITE_STATUSES).size === DOCTOR_WRITE_STATUSES.length);
check(
  'the writable list names only statuses the schema allows',
  DOCTOR_WRITE_STATUSES.every((s) => ALL_STATUSES.includes(s)),
  DOCTOR_WRITE_STATUSES.filter((s) => !ALL_STATUSES.includes(s)),
);

section('the gate follows the visit on screen, not the patient\'s newest one');
// The visit dropdown lists every visit a patient has ever had, so "the latest
// visit is fine" would wave a write through onto a closed older visit.
const patientHistory = [
  visit('Completed', { id: 'V-old', visitDate: '2026-01-05', visitTime: '10:00' }),
  visit('With Doctor', { id: 'V-new', visitDate: '2026-09-27', visitTime: '09:00' }),
];
check('the newest visit is the one the patient list opens', latestVisit(patientHistory)?.id === 'V-new');
check('and it is writable', mayDoctorWrite(latestVisit(patientHistory)) === true);
check('but the closed older visit is not', mayDoctorWrite(patientHistory[0]) === false);
check('a patient with no visits at all is not writable', isWithDoctor([]) === false);
check('a patient with no visits gets an explanation', /No visit is selected/.test(readOnlyReason(undefined) ?? ''));

section('"latest visit" means the same thing here as in the database layer');
const sameDay = [
  visit('With Nurse', { id: 'V-am', visitDate: '2026-09-27', visitTime: '08:00' }),
  visit('With Doctor', { id: 'V-pm', visitDate: '2026-09-27', visitTime: '14:00' }),
];
check('same day, later time wins', latestVisit(sameDay)?.id === 'V-pm');
check(
  'a visit with no time sorts as the earlier of its day',
  latestVisit([visit('With Doctor', { id: 'V-notime', visitTime: '' }), visit('With Nurse', { id: 'V-timed', visitTime: '14:00' })])?.id === 'V-timed',
);
check('isWithDoctor follows the latest visit', isWithDoctor(patientHistory) === true);
check('isWithDoctor is false while the patient is still with nursing', isWithDoctor([visit('With Nurse')]) === false);

// ---------------------------------------------------------------------------
// 2. Which examination column a finding belongs in
// ---------------------------------------------------------------------------

section('every system the examination dialog offers reaches its own column');
// The dialog's EXAM_SYSTEMS list. These are the exact strings saveExam writes into
// an entry title, and the two that used to be misfiled are the point of this.
const DIALOG_SYSTEMS = [
  'General',
  'Cardiovascular',
  'Respiratory',
  'Gastrointestinal',
  'Neurological',
  'Musculoskeletal',
  'Genitourinary',
  'Integumentary',
  'Endocrine',
  'Hematological',
  'Psychiatric',
];
const EXPECTED = {
  General: 'general',
  Cardiovascular: 'cardiovascular',
  Respiratory: 'respiratory',
  Gastrointestinal: 'abdomen',
  Neurological: 'neurological',
  Musculoskeletal: 'musculoskeletal',
  Genitourinary: 'other',
  Integumentary: 'other',
  Endocrine: 'other',
  Hematological: 'other',
  Psychiatric: 'other',
};
for (const system of DIALOG_SYSTEMS) {
  check(
    `${system} is filed under ${EXPECTED[system]}`,
    classifyExamEntry(`${system} - Deep tendon reflexes normal`) === EXPECTED[system],
    `got ${classifyExamEntry(`${system} - Deep tendon reflexes normal`)}`,
  );
}

section('a finding that mentions another system does not capture the entry');
// The finding text is free text. Matching anywhere in the title is what put a
// cardiovascular entry into the respiratory column whenever the doctor described
// the respiration in it.
check(
  'the system, not the finding, decides the column',
  classifyExamEntry('Cardiovascular - Respiration rate regular, no murmur') === 'cardiovascular',
  classifyExamEntry('Cardiovascular - Respiration rate regular, no murmur'),
);

section('titles written before the dialog existed still load into the right column');
// initExam builds its entries from the stored column names, which are not in the
// dialog's vocabulary, so a record saved before this change must not shift columns.
for (const [title, expected] of [
  ['General Examination', 'general'],
  ['Cardiovascular System', 'cardiovascular'],
  ['Respiratory System', 'respiratory'],
  ['Abdomen & GI', 'abdomen'],
  ['Central Nervous System', 'neurological'],
  ['Musculoskeletal', 'musculoskeletal'],
  ['Other Systems / Findings', 'other'],
]) {
  check(`${title} loads into ${expected}`, classifyExamEntry(title) === expected, classifyExamEntry(title));
}

section('an entry naming no system is kept, not dropped');
check('a bare title goes to other', classifyExamEntry('Patient cachectic') === 'other');
check('an empty title goes to other', classifyExamEntry('') === 'other');

section('the additional-findings entry is recognised and kept out of "other"');
// It has its own column, clinicalFindings. It used to be appended to "other" as
// well, so the same text was written to two columns on every save.
check('the seeded title is recognised', isAdditionalFindings('Additional Clinical Findings') === true);
check('the seeded title is not treated as a system', classifyExamEntry('Additional Clinical Findings') !== 'general');
check('a doctor-renamed one is still recognised', isAdditionalFindings('Additional findings - no oedema') === true);
check('a normal system entry is not', isAdditionalFindings('Respiratory System') === false);

// ---------------------------------------------------------------------------
// 3. Surgery History: structured entries in one text column
// ---------------------------------------------------------------------------

section('surgery history survives the round trip through the text column');
const surgeries = [
  { id: 's1', date: '2010-04-02', hospital: 'Lagos University Teaching Hospital', surgeryType: 'Appendicectomy', notes: 'Recurrence in 2018' },
  { id: 's2', date: '', hospital: '', surgeryType: 'Laparoscopic cholecystectomy', notes: '' },
];
const formatted = formatSurgeryHistory(surgeryEntriesFixture(surgeries));
check('two surgeries become two lines', formatted.split('\n').length === 2, formatted);
const parsed = parseSurgeryHistory(formatted);
check('both come back', parsed.length === 2, parsed);
check('the date comes back', parsed[0].date === '2010-04-02', parsed[0]);
check('the hospital comes back', parsed[0].hospital === 'Lagos University Teaching Hospital', parsed[0]);
check('the procedure comes back', parsed[0].surgeryType === 'Appendicectomy', parsed[0]);
check('the notes come back', parsed[0].notes === 'Recurrence in 2018', parsed[0]);
check('an entry with no date keeps an empty date', parsed[1].date === '', parsed[1]);
check('a second save is byte-identical', formatSurgeryHistory(parsed) === formatted);

section('notes may contain the separator');
// Notes are free text written by a clinician. Splitting on every pipe would cut a
// note in half and lose the rest of it.
const withPipes = [{ id: 's1', date: '2019-01-01', hospital: 'H', surgeryType: 'Bariatric bypass', notes: 'BMI 42 | 38 | 36' }];
const pipeFormatted = formatSurgeryHistory(withPipes);
check('a note with pipes round-trips whole', parseSurgeryHistory(pipeFormatted)[0].notes === 'BMI 42 | 38 | 36', parseSurgeryHistory(pipeFormatted)[0]);

section('an empty list and empty text are both empty');
check('no entries formats to an empty string', formatSurgeryHistory([]) === '');
check('empty text parses to no entries', parseSurgeryHistory('').length === 0);
check('whitespace parses to no entries', parseSurgeryHistory('   \n  ').length === 0);
check('absent text parses to no entries', parseSurgeryHistory(null).length === 0);

section('an entry with no procedure is not written');
check('a blank procedure is skipped', formatSurgeryHistory([{ id: 'x', date: '2020-01-01', hospital: 'H', surgeryType: '  ', notes: 'orphan' }]) === '');

section('text a clinician typed by hand is never lost');
// The same column is reachable as free text from the Complaint & History tab, and
// a line this module did not write must come back as something rather than vanish.
const handwritten = 'Appendicectomy in 2010 at LUTH';
const back = parseSurgeryHistory(handwritten);
check('an unrecognised line still yields an entry', back.length === 1, back);
check('and keeps its text', back[0].surgeryType === handwritten, back[0]);
check('and is not claimed as structured', isStructuredSurgeryHistory(handwritten) === false);
check('a real list is claimed as structured', isStructuredSurgeryHistory(formatted) === true);
check('empty text is not structured', isStructuredSurgeryHistory('') === false);
check(
  'a mix of structured and handwritten lines is not claimed as structured',
  isStructuredSurgeryHistory(`${formatted}\n${handwritten}`) === false,
);

/** The real thing, so the test cannot drift from the shape the dialog produces. */
function surgeryEntriesFixture(list) {
  return list;
}

// ---------------------------------------------------------------------------

console.log('');
if (failures) {
  console.log(`[consultation self-test] ${failures} of ${checks} checks FAILED`);
  process.exitCode = 1;
} else {
  console.log(`[consultation self-test] all ${checks} checks behaved as expected`);
}
