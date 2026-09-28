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
const {
  entryText,
  foldHistory,
  foldImpression,
  foldPlan,
  seedComplaintEntries,
  seedDiagnosisEntries,
  seedExamEntries,
  seedManagementEntries,
  seedSurgeryEntries,
  foldNotes,
  seededLists,
  stripTitlePrefix,
  isNotesEntry,
  ASSESSMENT_TITLE,
  NOTES_TITLE,
  PLAN_TITLE,
} = await import('../src/services/consultationSeed.ts');
const {
  VITALS_LIMITS,
  BMI_MAX,
  BMI_CATEGORIES,
  bmiCategoryFor,
  checkBloodPressureOrder,
  checkVitals,
  checkVitalsField,
  computeBmi,
  normaliseHeight,
  alertsFor,
  HEIGHT_MIN,
  HEIGHT_MAX,
  WEIGHT_MAX,
} = await import('../src/services/vitalsLimits.ts');

const SCHEMA_SQL = fs.readFileSync(path.join(ROOT, 'database', 'fatclinic.sql'), 'utf8');

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
// Seeding a consultation from what is already stored
// ---------------------------------------------------------------------------
//
// This is the check for the worst bug found in this screen, and it is worth
// stating plainly what it was. `initDiagnosis` seeded a visit that had never
// been consulted with a worked example:
//
//   Plasmodium falciparum malaria, unspecified / B50.9 / Primary
//
// A doctor opening a patient they had never seen, and pressing Save without
// typing anything, wrote that fabricated diagnosis into the patient's medical
// record. Every other list correctly started empty. The earlier bug in this
// screen lost data silently; this one invented it, which is worse: the record
// then asserts that a clinician diagnosed malaria, and no amount of care later
// can tell that nobody did.
//
// The rule, in one line: a list describes what was recorded. If nothing was
// recorded, the list is empty.

section('a consultation that has never been saved seeds nothing at all');

const noConsultation = seededLists(undefined);
for (const [name, list] of Object.entries(noConsultation)) {
  check(
    `a visit with no consultation seeds no ${name} entries`,
    list.length === 0,
    `${list.length} invented: ${JSON.stringify(list)}`,
  );
}
check(
  'and specifically no diagnosis, which is where the example was',
  seedDiagnosisEntries(undefined).length === 0,
  JSON.stringify(seedDiagnosisEntries(undefined)),
);

// Guard the reintroduced example by name, not just by behaviour: a "helpful"
// default is easy to add back and hard to notice, and the behaviour check above
// would still pass if it were added somewhere that a doctor cannot reach.
//
// Comments are stripped first, because this file's own header explains the defect
// in full and quotes the example. A check that flagged its own explanation would
// be a check that gets deleted the first time somebody tidies the comment.
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ').replace(/\/\/.*$/gm, ' ');
const seedSource = stripComments(fs.readFileSync(path.join(ROOT, 'src/services/consultationSeed.ts'), 'utf8'));
for (const [label, needle] of [
  ['a malaria diagnosis', 'B50.9'],
  ['the example description', 'Acute uncomplicated malaria'],
]) {
  check(
    `${label} is nowhere in the seeding module`,
    !seedSource.includes(needle),
    `found ${JSON.stringify(needle)} in src/services/consultationSeed.ts`,
  );
}

section('a consultation that has been saved seeds what was actually stored');

const stored = {
  id: 'C-1',
  visitId: 'V-1',
  patientId: 'P-1',
  physicianId: 'USR-1',
  physicianName: 'Dr Who',
  consultationDate: '2026-09-27T09:00:00.000Z',
  presentingComplaint: 'Fever and headache',
  historyOfPresentingComplaint: 'Three days, worse at night',
  pastMedicalHistory: '',
  surgicalHistory: '2010-04-02 | LUTH | Appendicectomy | No recurrence',
  drugHistory: 'Paracetamol as needed',
  familyHistory: '',
  socialHistory: '',
  allergyHistory: '',
  physicalExamination: {
    general: 'Febrile',
    cardiovascular: '',
    respiratory: '',
    abdomen: 'Tender right iliac fossa',
    neurological: '',
    musculoskeletal: '',
    other: '',
  },
  clinicalFindings: '',
  assessment: 'Acute appendicitis',
  diagnoses: [
    { id: 'CDX-1', code: 'K35.8', description: 'Acute appendicitis', type: 'Primary' },
    { id: 'CDX-2', code: 'R50.9', description: 'Fever, unspecified', type: 'Secondary' },
  ],
  plan: 'Appendicectomy. Review in one week.',
  followUpDate: '2026-10-04',
  clinicalNotes: 'Patient counselled',
};

const seeded = seededLists(stored);
check('the complaint list holds only the fields that were filled in', (() => {
  const titles = seeded.complaint.map((e) => e.title);
  return (
    titles.includes('Presenting Complaint') &&
    titles.includes('History of Presenting Complaint') &&
    titles.includes('Drug / Medication History') &&
    !titles.includes('Past Medical History') &&
    !titles.includes('Family History')
  );
})(), JSON.stringify(seeded.complaint.map((e) => e.title)));

check('a filled examination system becomes its own entry', (() => {
  const titles = seeded.exam.map((e) => e.title);
  return titles.includes('General Examination') && titles.includes('Abdomen & GI') && titles.includes('Cardiovascular System') === false;
})(), JSON.stringify(seeded.exam.map((e) => e.title)));

check('the surgery column is read back as surgery entries', (() => {
  return seeded.surgery.length === 1 && seeded.surgery[0].surgeryType === 'Appendicectomy' && seeded.surgery[0].date === '2010-04-02';
})(), JSON.stringify(seeded.surgery));

check(
  'the operations do not also appear in the complaint list',
  !seeded.complaint.some((e) => e.title === 'Surgical History'),
  JSON.stringify(seeded.complaint.map((e) => e.title)),
);

check('both diagnoses come back with their codes and types', (() => {
  const coded = seeded.diagnosis.filter((d) => d.isCoded);
  return (
    coded.length === 2 &&
    coded[0].code === 'K35.8' &&
    coded[0].type === 'Primary' &&
    coded[1].code === 'R50.9' &&
    coded[1].type === 'Secondary'
  );
})(), JSON.stringify(seeded.diagnosis));

check('the assessment comes back as the clinical impression', (() => {
  const imp = seeded.diagnosis.find((d) => d.id === 'dx-assess');
  return !!imp && imp.body === 'Acute appendicitis' && imp.isCoded === false;
})(), JSON.stringify(seeded.diagnosis));

check('the plan and the notes both come back', (() => {
  const titles = seeded.management.map((e) => e.title);
  return titles.includes('Treatment Plan') && titles.includes('Clinical Notes');
})(), JSON.stringify(seeded.management.map((e) => e.title)));

check(
  'every seeder agrees with seededLists, so the two cannot drift',
  seedComplaintEntries(stored).length === seeded.complaint.length &&
    seedExamEntries(stored).length === seeded.exam.length &&
    seedSurgeryEntries(stored).length === seeded.surgery.length &&
    seedDiagnosisEntries(stored).length === seeded.diagnosis.length &&
    seedManagementEntries(stored).length === seeded.management.length,
);

// ---------------------------------------------------------------------------
// Folding the entries back into the seven history columns
// ---------------------------------------------------------------------------
//
// The dialog has two required boxes per entry - "Complaint" and "Details" - and
// the save folded only the Details box into the record. A clinician who wrote
// "Fever and headache for three days" into the Complaint box and "worse at night"
// into Details kept the second and lost the first, with no error and no warning:
// the form said "Saved!". Found by saving one in a browser and reading the
// database, which is the only way to see this class of thing at all.

section('both boxes a doctor filled in reach the record');

const both = [
  { id: 'x1', title: 'Presenting Complaint', complaint: 'Fever and headache for three days', body: 'Worse at night, no rigors' },
  { id: 'x2', title: 'History of Presenting Complaint', complaint: 'No previous episode', body: '' },
  { id: 'x3', title: 'Past Medical History', complaint: 'Hypertension since 2019', body: '' },
  { id: 'x4', title: 'Drug History', complaint: 'Amlodipine 5mg daily', body: 'Started 3 years ago' },
  { id: 'x5', title: 'Family History', complaint: 'Father diabetic', body: '' },
  { id: 'x6', title: 'Social History', complaint: 'Non-smoker', body: '' },
  { id: 'x7', title: 'Allergy History', complaint: 'No known allergies', body: '' },
];
const folded = foldHistory(both);

check(
  'the Complaint box reaches presenting_complaint',
  folded.presentingComplaint.includes('Fever and headache for three days'),
  folded.presentingComplaint,
);
check(
  'and so does the Details box, rather than one replacing the other',
  folded.presentingComplaint.includes('Worse at night, no rigors'),
  folded.presentingComplaint,
);
check('history of presenting complaint folds into its own column', folded.historyOfPresentingComplaint === 'No previous episode', folded.historyOfPresentingComplaint);
check('past medical history folds into its own column', folded.pastMedicalHistory === 'Hypertension since 2019', folded.pastMedicalHistory);
check('drug history keeps both boxes too', (() => {
  return folded.drugHistory.includes('Amlodipine 5mg daily') && folded.drugHistory.includes('Started 3 years ago');
})(), folded.drugHistory);
check('family history folds into its own column', folded.familyHistory === 'Father diabetic', folded.familyHistory);
check('social history folds into its own column', folded.socialHistory === 'Non-smoker', folded.socialHistory);
check('allergy history folds into its own column', folded.allergyHistory === 'No known allergies', folded.allergyHistory);

check(
  'a complaint with only a Details box still folds, for records written before',
  foldHistory([{ id: 'y1', title: 'Presenting Complaint', body: 'Legacy free text' }]).presentingComplaint === 'Legacy free text',
  JSON.stringify(foldHistory([{ id: 'y1', title: 'Presenting Complaint', body: 'Legacy free text' }])),
);

check(
  'an entry titled something else becomes the presenting complaint, as before',
  foldHistory([{ id: 'z1', title: 'Patient walked in unwell', complaint: 'Cough', body: '' }]).presentingComplaint === 'Cough',
  JSON.stringify(foldHistory([{ id: 'z1', title: 'Patient walked in unwell', complaint: 'Cough', body: '' }])),
);

check('no entries fold to empty columns, not to undefined', (() => {
  const empty = foldHistory([]);
  return Object.values(empty).every((v) => v === '');
})(), JSON.stringify(foldHistory([])));

check(
  'a structured surgical history in the Complaint tab is not mistaken for free text',
  foldHistory([{ id: 'w1', title: 'Surgical History', complaint: '2010-04-02 | LUTH | Appendicectomy | none', body: '' }]).surgicalHistory
    === '2010-04-02 | LUTH | Appendicectomy | none',
);

section('what the screen shows is what gets stored');

// The whole reason entryText is a single function rather than two independent
// selections. A display that shows more than it saves is how a doctor ends up
// believing a finding is on the record when it is not.
check('entryText shows the Complaint box when Details is empty', entryText({ id: 'a', title: 't', complaint: 'Only complaint', body: '' }) === 'Only complaint');
check('entryText shows the Details box when Complaint is empty', entryText({ id: 'b', title: 't', complaint: '', body: 'Only details' }) === 'Only details');
check('entryText shows both when both are filled', (() => {
  const t = entryText({ id: 'c', title: 't', complaint: 'A', body: 'B' });
  return t.includes('A') && t.includes('B');
})());
check('entryText skips a box holding only whitespace', entryText({ id: 'd', title: 't', complaint: 'A', body: '   ' }) === 'A');
check('entryText of an empty entry is empty, not "undefined"', entryText({ id: 'e', title: 't' }) === '');

check(
  'a stored consultation re-seeds and folds back to the same text',
  foldHistory(seedComplaintEntries(stored)).presentingComplaint === stored.presentingComplaint,
  JSON.stringify(foldHistory(seedComplaintEntries(stored)).presentingComplaint),
);
check(
  'and it survives a second round trip unchanged, so editing twice is not lossy',
  (() => {
    const once = seedComplaintEntries(stored);
    const refolded = foldHistory(once);
    const rebuilt = { ...stored, presentingComplaint: refolded.presentingComplaint, historyOfPresentingComplaint: refolded.historyOfPresentingComplaint, pastMedicalHistory: refolded.pastMedicalHistory, drugHistory: refolded.drugHistory, familyHistory: refolded.familyHistory, socialHistory: refolded.socialHistory };
    const twice = seedComplaintEntries(rebuilt);
    return foldHistory(twice).presentingComplaint === refolded.presentingComplaint
      && foldHistory(twice).drugHistory === refolded.drugHistory;
  })(),
);

// ---------------------------------------------------------------------------
// Saving a consultation that is already stored must not change it
// ---------------------------------------------------------------------------
//
// The plan and the impression are single free-text columns, and each is folded as
// "Title: text". The seed read that column back as one entry whose *body* was the
// whole string, title and all - so the fold put a second title in front of it:
//
//   Treatment Plan: Treatment Plan: Appendicectomy. Review in one week
//
// and every save after that added another. A doctor's own words were pushed
// further down the column each time they opened the patient, and nothing said so.
//
// The property that matters is not that the text is right once, but that it does
// not move: save, reload, save again, and the column must be byte-identical
// however many times the pair is run. These checks run it several times over.

section('saving a stored consultation again changes nothing');

const withPlanAndImpression = {
  ...stored,
  plan: `${PLAN_TITLE}: Appendicectomy. Review in one week.`,
  assessment: `${ASSESSMENT_TITLE}: Acute appendicitis`,
};

check(
  'the plan comes back as the text, not the text with the title still on it',
  seedManagementEntries(withPlanAndImpression)[0].body === 'Appendicectomy. Review in one week.',
  JSON.stringify(seedManagementEntries(withPlanAndImpression)),
);
check(
  'and the impression likewise',
  seedDiagnosisEntries(withPlanAndImpression).find((d) => d.id === 'dx-assess')?.body === 'Acute appendicitis',
  JSON.stringify(seedDiagnosisEntries(withPlanAndImpression)),
);
check(
  're-folding the seeded plan reproduces the stored column exactly',
  foldPlan(seedManagementEntries(withPlanAndImpression)) === withPlanAndImpression.plan,
  `${foldPlan(seedManagementEntries(withPlanAndImpression))} vs ${withPlanAndImpression.plan}`,
);
check(
  're-folding the seeded impression reproduces the stored column exactly',
  foldImpression(seedDiagnosisEntries(withPlanAndImpression)) === withPlanAndImpression.assessment,
  `${foldImpression(seedDiagnosisEntries(withPlanAndImpression))} vs ${withPlanAndImpression.assessment}`,
);

// The real test: the same value after any number of round trips.
const settle = (start, key) => {
  let value = start;
  for (let i = 0; i < 5; i++) {
    const next = key === 'plan'
      ? foldPlan(seedManagementEntries({ plan: value }))
      : foldImpression(seedDiagnosisEntries({ assessment: value }));
    if (next !== value) return { stable: false, at: i + 1, value: next };
    value = next;
  }
  return { stable: true, value };
};
const planSettle = settle(withPlanAndImpression.plan, 'plan');
const impSettle = settle(withPlanAndImpression.assessment, 'impression');
check('the plan is the same after five save-and-reload cycles', planSettle.stable, `changed on cycle ${planSettle.at}: ${planSettle.value}`);
check('the impression is the same after five save-and-reload cycles', impSettle.stable, `changed on cycle ${impSettle.at}: ${impSettle.value}`);

check(
  'a plan a clinician wrote without any title is left alone, and then stays put',
  (() => {
    const once = foldPlan(seedManagementEntries({ plan: 'Bed rest, fluids, review Friday' }));
    const twice = foldPlan(seedManagementEntries({ plan: once }));
    return once === `${PLAN_TITLE}: Bed rest, fluids, review Friday` && twice === once;
  })(),
);
check(
  'a plan that genuinely begins with the words is trimmed once, then stable',
  (() => {
    const once = foldPlan(seedManagementEntries({ plan: 'Treatment Plan: rest and fluids' }));
    const twice = foldPlan(seedManagementEntries({ plan: once }));
    return once === `${PLAN_TITLE}: rest and fluids` && twice === once;
  })(),
);
check(
  'a clinician who renames the entry keeps their title and does not gain a second one',
  (() => {
    const entries = [{ id: 'm0', title: 'Advice Given', body: 'Avoid strenuous activity', date: '', category: 'Advice' }];
    const once = foldPlan(entries);
    const twice = foldPlan([{ id: 'm0', title: 'Advice Given', body: stripTitlePrefix(once, 'Advice Given'), date: '', category: 'Advice' }]);
    return once === 'Advice Given: Avoid strenuous activity' && twice === once;
  })(),
);
check('several plan items each keep their own title', (() => {
  const out = foldPlan([
    { id: 'a', title: PLAN_TITLE, body: 'Appendicectomy', date: '', category: 'Therapeutics' },
    { id: 'b', title: 'Patient Advice', body: 'Avoid lifting for six weeks', date: '', category: 'Advice' },
  ]);
  return out === 'Treatment Plan: Appendicectomy\nPatient Advice: Avoid lifting for six weeks';
})(), foldPlan([{ id: 'a', title: PLAN_TITLE, body: 'Appendicectomy', date: '', category: 'Therapeutics' }]));
check('no plan items fold to an empty string, not to "undefined"', foldPlan([]) === '', JSON.stringify(foldPlan([])));
check('no impression entries fold to an empty string', foldImpression([]) === '', JSON.stringify(foldImpression([])));
check('a coded diagnosis is not treated as an impression', foldImpression([{ id: 'x', title: 'Acute appendicitis', body: 'Acute appendicitis', isCoded: true, code: 'K35.8', type: 'Primary' }]) === '');

// The clinical notes have their own column. Folding them into the plan as well
// wrote a clinician's note into the treatment plan and into the notes, so it sat
// on the record twice and read as part of the plan the first time.
section('the notes stay out of the plan');

const seededMgmt = seedManagementEntries(withPlanAndImpression);
check('a seeded consultation produces a plan entry and a notes entry', (() => {
  const titles = seededMgmt.map((m) => m.title);
  // Compared against the module's own test, not a hardcoded 'note': the whole
  // point of `isNotesEntry` is that the seed and the fold agree on which entries
  // are notes, and a test that spelled the word out again would pass even if the
  // two disagreed with each other.
  return titles.includes(PLAN_TITLE) && seededMgmt.filter(isNotesEntry).length === 1;
})(), JSON.stringify(seededMgmt.map((m) => m.title)));

check('the plan column does not contain the note', !foldPlan(seededMgmt).includes('Patient counselled'), foldPlan(seededMgmt));
check('the notes column holds the note', foldNotes(seededMgmt) === 'Patient counselled', JSON.stringify(foldNotes(seededMgmt)));
check('a notes entry alone leaves the plan empty', foldPlan([{ id: 'n', title: NOTES_TITLE, body: 'Counselled', category: 'Notes' }]) === '', foldPlan([{ id: 'n', title: NOTES_TITLE, body: 'Counselled', category: 'Notes' }]));
check('a plan entry alone leaves the notes empty', foldNotes([{ id: 'p', title: PLAN_TITLE, body: 'Appendicectomy', category: 'Therapeutics' }]) === '');
check('a renamed notes entry is still recognised as notes', foldPlan([{ id: 'n', title: 'Ward Round Notes', body: 'Seen on the ward', category: 'Notes' }]) === '' && foldNotes([{ id: 'n', title: 'Ward Round Notes', body: 'Seen on the ward', category: 'Notes' }]) === 'Seen on the ward');
check(
  'and the note is not in the plan after a save-and-reload cycle either',
  (() => {
    let planValue = withPlanAndImpression.plan;
    for (let i = 0; i < 5; i++) {
      planValue = foldPlan(seedManagementEntries({ plan: planValue, clinicalNotes: 'Patient counselled' }));
      if (planValue.includes('Patient counselled')) return false;
    }
    return planValue === withPlanAndImpression.plan;
  })(),
  foldPlan(seedManagementEntries({ plan: withPlanAndImpression.plan, clinicalNotes: 'Patient counselled' })),
);
check(
  'a stored column that already contains the note has it removed on the next save',
  (() => {
    // A record written by the old fold. The note is in the plan column, and
    // fixing the record means it stops being there.
    const legacy = `${PLAN_TITLE}: Appendicectomy\nClinical Notes: Patient counselled`;
    const next = foldPlan(seedManagementEntries({ plan: legacy, clinicalNotes: 'Patient counselled' }));
    return next === `${PLAN_TITLE}: Appendicectomy`;
  })(),
  foldPlan(seedManagementEntries({ plan: `${PLAN_TITLE}: Appendicectomy\nClinical Notes: Patient counselled`, clinicalNotes: 'Patient counselled' })),
);

// ---------------------------------------------------------------------------
// 17. The vitals the form accepts, and the column the database has
// ---------------------------------------------------------------------------
//
// The bug: the nursing form checked only whether a box was EMPTY. The vitals
// table carries a CHECK constraint per measurement, so a nurse who typed T 22,
// BP 22/111 and pulse 11 was told "Recorded!", an audit row claimed the vitals
// were recorded, and Postgres refused the insert outright - bmi is NUMERIC(4,1)
// and cannot hold the 22400 the arithmetic produced. The table held nothing.
//
// These checks are what stand between that and a chart that says one thing and
// holds another. The ranges in vitalsLimits.ts are transcribed from the CHECK
// constraints, and the first group below holds them to the schema file; the live
// half of the proof is in db:crud, which reads the running database's
// constraints rather than this file.

section('17. the vitals form refuses what the column cannot hold');

const goodVitals = {
  temperature: 37.2,
  systolicBp: 120,
  diastolicBp: 80,
  pulse: 72,
  respiratoryRate: 16,
  spo2: 98,
  weight: 70,
  height: 1.75,
};

check('a complete, ordinary reading is accepted', checkVitals(goodVitals).length === 0, checkVitals(goodVitals));
check(
  'the reading the live database refused is refused here too',
  checkVitals({ ...goodVitals, temperature: 22, systolicBp: 22, diastolicBp: 111, pulse: 11, weight: 224, height: 0.1 }).length > 0,
);
check(
  'a temperature below the column minimum is named as such',
  checkVitalsField('temperature', 24.9).some((p) => p.field === 'temperature' && /25 to 45/.test(p.message)),
  checkVitalsField('temperature', 24.9),
);
check(
  'the exact minimum is accepted, because the column accepts it',
  checkVitalsField('temperature', 25).length === 0,
  checkVitalsField('temperature', 25),
);
check(
  'the exact maximum is accepted, because the column accepts it',
  checkVitalsField('temperature', 45).length === 0,
  checkVitalsField('temperature', 45),
);
check(
  'a value one place past the maximum is refused',
  checkVitalsField('temperature', 45.1).length === 1,
);
check('a blank box is a missing reading, not a measurement of nothing', checkVitalsField('pulse', '').some((p) => /not been recorded/.test(p.message)));
check('a non-numeric entry is refused by name', checkVitalsField('pulse', 'abc').some((p) => /must be a number/.test(p.message)));
check('a zero weight is refused, because the column demands > 0', checkVitalsField('weight', 0).length === 1);
check('a negative weight is refused', checkVitalsField('weight', -5).length === 1);
check(
  'a diastolic above the systolic is refused',
  checkBloodPressureOrder(80, 120).length === 1,
  checkBloodPressureOrder(80, 120),
);
check(
  'the refusal says which reading is which',
  /lower reading is diastolic/.test(checkBloodPressureOrder(80, 120)[0].message),
);
check('diastolic equal to systolic is allowed - the column allows it', checkBloodPressureOrder(90, 90).length === 0);
check(
  'a pain score off the 0-10 scale is refused',
  checkVitals({ ...goodVitals, painScore: 11 }).some((p) => p.field === 'painScore'),
);
check('a pain score in scale is accepted', checkVitals({ ...goodVitals, painScore: 7 }).length === 0);
check('a pain score left blank is fine, because the column is nullable', checkVitals({ ...goodVitals, painScore: '' }).length === 0);

section('18. BMI: one calculation, shared by the banner and the save');

// The BMI arithmetic existed in three places - the live banner, db.recordVitals
// and the audit message - and each could round or categorise differently. If the
// banner says one category and the record holds another, the nurse is reading a
// different chart from the one being written.
check('a normal reading calculates its BMI', computeBmi(70, 1.75).bmi === 22.9, computeBmi(70, 1.75));
check('the category follows the BMI', computeBmi(70, 1.75).category === 'Normal');
check('BMI is rounded to one decimal, as the column is', computeBmi(70, 1.75).bmi === Number((70 / (1.75 * 1.75)).toFixed(1)));
check('the banner and the save cannot disagree on the category', (() => {
  const shown = computeBmi(95, 1.75);
  const saved = computeBmi(95, 1.75);
  return shown.category === saved.category;
})());
check('an underweight reading is categorised', bmiCategoryFor(17) === 'Underweight');
check('an obese class III reading is categorised', bmiCategoryFor(45) === 'Obese Class III');
check('the boundary values land on the documented side', bmiCategoryFor(18.4) === 'Underweight' && bmiCategoryFor(18.5) === 'Normal');
check('every category the code can return is one the column allows', BMI_CATEGORIES.every((c) => c === 'Underweight' || c === 'Normal' || c === 'Overweight' || /^Obese Class [I]{1,3}$/.test(c)));

check(
  'a weight and height that each pass, but whose BMI will not fit, is refused',
  'problem' in computeBmi(WEIGHT_MAX, HEIGHT_MIN),
  computeBmi(WEIGHT_MAX, HEIGHT_MIN),
);
check(
  'the refusal names the BMI, and both readings behind it',
  /BMI/.test(computeBmi(WEIGHT_MAX, HEIGHT_MIN).problem.message) && /height/i.test(computeBmi(WEIGHT_MAX, HEIGHT_MIN).problem.message),
);
check('a BMI that would overflow NUMERIC(4,1) is never returned', !('bmi' in computeBmi(WEIGHT_MAX, HEIGHT_MIN)) || computeBmi(WEIGHT_MAX, HEIGHT_MIN).bmi <= BMI_MAX);
check('a height of zero cannot be divided by', 'problem' in computeBmi(70, 0));
check('the form refuses that reading before the save', checkVitals({ ...goodVitals, weight: 400, height: 0.5 }).length > 0);
check('centimetres are converted, because that is how it is measured', normaliseHeight(175) === 1.75);
check('metres are left alone', normaliseHeight(1.75) === 1.75);
check('the banner and the save convert height the same way', computeBmi(70, normaliseHeight(175)).bmi === computeBmi(70, normaliseHeight(1.75)).bmi);

section('19. the limits in the code are the limits in the schema');

// This is the group that makes the rest honest. A range widened here without the
// schema would let a reading through that the database then refuses - the exact
// bug, reintroduced. So each range is matched against the SQL the app ships.
const vitalsTable = SCHEMA_SQL.slice(SCHEMA_SQL.indexOf('CREATE TABLE IF NOT EXISTS vitals'), SCHEMA_SQL.indexOf('CREATE TABLE IF NOT EXISTS consultations'));
check('the vitals table was found in the schema file', vitalsTable.length > 0);

for (const limit of VITALS_LIMITS) {
  const column = {
    temperature: 'temperature_c',
    systolicBp: 'systolic_bp',
    diastolicBp: 'diastolic_bp',
    pulse: 'pulse_bpm',
    respiratoryRate: 'respiratory_rate',
    spo2: 'spo2_pct',
    weight: 'weight_kg',
    height: 'height_m',
  }[limit.field];
  if (limit.positiveOnly) {
    // The numeric precision sits between the column name and NOT NULL, and the
    // schema is aligned with spaces, so the pattern allows whitespace rather than
    // pinning the exact layout - a reformat of the SQL must not fail this.
    check(
      `vitalsLimits ${limit.field} matches the schema's rule for ${column}`,
      new RegExp(`${column}\\s+NUMERIC\\(\\d+,\\d+\\)\\s+NOT NULL\\s+CHECK\\s*\\(\\s*${column}\\s*>\\s*0\\s*\\)`).test(vitalsTable),
      `schema has no: CHECK (${column} > 0) on a NOT NULL column`,
    );
  } else {
    const escaped = limit.min === 0 ? '0' : String(limit.min);
    const upper = limit.max === 100 ? '100' : String(limit.max);
    check(
      `vitalsLimits ${limit.field} matches the schema's range for ${column}`,
      new RegExp(`CHECK \\(${column} BETWEEN ${escaped} AND ${upper}\\)`).test(vitalsTable),
      `schema has no: CHECK (${column} BETWEEN ${escaped} AND ${upper})`,
    );
  }
}

check('the schema carries the cross-field blood pressure rule', /CHECK \(diastolic_bp <= systolic_bp\)/.test(vitalsTable));
check('and the form enforces it', checkBloodPressureOrder(70, 140).length === 1);
check('the BMI column is as narrow as the arithmetic assumes', /bmi\s+NUMERIC\(4,1\)/.test(vitalsTable));
check('and the BMI guard is that column, not a guess', BMI_MAX === 999.9);
check('the BMI category CHECK allows exactly the categories the code returns', (() => {
  const allowed = [...vitalsTable.matchAll(/'(Underweight|Normal|Overweight|Obese Class I{1,3})'/g)].map((m) => m[1]);
  return allowed.length > 0 && BMI_CATEGORIES.every((c) => allowed.includes(c)) && allowed.every((c) => BMI_CATEGORIES.includes(c));
})());
check('the pain score scale in the code is the schema CHECK', /pain_score\s+INTEGER CHECK \(pain_score BETWEEN 0 AND 10\)/.test(vitalsTable));

section('20. the alerts the form raises are clinical, and come from one place');

check('a fever raises the fever alert', alertsFor({ ...goodVitals, temperature: 39 }).includes('High Grade Fever Spike'));
check('a normal temperature raises nothing', alertsFor({ ...goodVitals, temperature: 37 }).length === 0);
check('the fever threshold is the clinical one', (() => { try { return !alertsFor({ ...goodVitals, temperature: 37.9 }).includes('High Grade Fever Spike'); } catch { return false; } })());
check('a critical saturation is raised, not hidden', alertsFor({ ...goodVitals, spo2: 85 }).includes('Critical Oxygen Saturation'));
check('a healthy saturation raises nothing', alertsFor({ ...goodVitals, spo2: 98 }).length === 0);
check('the alert list and the refusal list cannot both be empty for a bad reading', (() => {
  const bad = { ...goodVitals, temperature: 22 };
  return checkVitals(bad).length > 0;
})());

// ---------------------------------------------------------------------------

console.log('');
if (failures) {
  console.log(`[consultation self-test] ${failures} of ${checks} checks FAILED`);
  process.exitCode = 1;
} else {
  console.log(`[consultation self-test] all ${checks} checks behaved as expected`);
}
