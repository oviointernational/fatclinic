// How the consultation's five entry lists are seeded from a stored consultation.
//
// This was logic inside ConsultationForm.tsx, where it could not be tested, and
// it was wrong: when a visit had no consultation yet, the diagnosis list was
// seeded with a fabricated example -
//
//   Plasmodium falciparum malaria, unspecified / B50.9 / Primary
//
// so a doctor who opened a patient they had never consulted and pressed Save
// wrote invented clinical data into that patient's record. Every other list
// correctly started empty. The other silent-data bugs in this app were all found
// the same way, by something in a component that nothing could check, so the
// seeding now lives here where it can be.
//
// The rule these functions exist to enforce: a list describes what was recorded.
// If nothing was recorded, the list is empty. Nothing here may invent a finding,
// a diagnosis or a plan, ever, and `seededContentIsEmpty` exists so that a test
// can say so about all five lists at once.
import { isStructuredSurgeryHistory, parseSurgeryHistory, type SurgeryHistoryEntry } from './surgeryHistory';
import type { Consultation, PhysicalExamination } from '../types';

export interface EntryItem {
  id: string;
  title: string;
  body: string;
  complaint?: string;
}

export interface DiagnosisEntry {
  id: string;
  title: string;
  body: string;
  isCoded: boolean;
  code: string;
  type: 'Primary' | 'Secondary';
}

export interface ManagementEntry {
  id: string;
  title: string;
  body: string;
  date?: string;
  priority?: string;
  category?: string;
}

export function seedComplaintEntries(c: Consultation | undefined): EntryItem[] {
  if (!c) return [];
  const arr: EntryItem[] = [];
  // `complaint`, not `body`: the stored text is the headline, and the dialog's
  // Details box is the elaboration of it. Putting it in `complaint` means
  // re-opening the entry and saving again produces the same text rather than
  // migrating it from one box to the other on every edit.
  if (c.presentingComplaint) arr.push({ id: 'c0', title: 'Presenting Complaint', complaint: c.presentingComplaint, body: '' });
  if (c.historyOfPresentingComplaint) arr.push({ id: 'c1', title: 'History of Presenting Complaint', complaint: c.historyOfPresentingComplaint, body: '' });
  if (c.pastMedicalHistory) arr.push({ id: 'c2', title: 'Past Medical History', complaint: c.pastMedicalHistory, body: '' });
  // Only when it is free text. Once the Surgery History tab owns the column the
  // same operations would appear twice, and saving would keep whichever copy the
  // Complaint tab happened to hold - silently discarding the structured one.
  if (c.surgicalHistory && !isStructuredSurgeryHistory(c.surgicalHistory)) arr.push({ id: 'c3', title: 'Surgical History', complaint: c.surgicalHistory, body: '' });
  if (c.drugHistory) arr.push({ id: 'c4', title: 'Drug / Medication History', complaint: c.drugHistory, body: '' });
  if (c.familyHistory) arr.push({ id: 'c5', title: 'Family History', complaint: c.familyHistory, body: '' });
  if (c.socialHistory) arr.push({ id: 'c6', title: 'Social / Occupational History', complaint: c.socialHistory, body: '' });
  if (c.allergyHistory) arr.push({ id: 'c7', title: 'Allergy History', complaint: c.allergyHistory, body: '' });
  return arr;
}

/**
 * Everything a doctor typed into one entry, in the order they typed it.
 *
 * The dialog has two boxes - "Complaint" and "Details" - and the save used to
 * fold only `body` into the record, so a clinician who wrote the complaint in
 * the Complaint box and the elaboration in Details lost the complaint. The
 * symptom is the same one this screen was already failing on, in a different
 * column: a required field on the form that no code path ever wrote.
 *
 * One function serves both the on-screen list and the save, deliberately. Two
 * code paths that each pick their own subset of what the doctor typed are two
 * opportunities to show them something different from what gets stored, and the
 * version that shows more than it stores is the one that loses the text.
 */
export function entryText(entry: EntryItem): string {
  return [entry.complaint, entry.body]
    .filter((t): t is string => typeof t === 'string' && t.trim() !== '')
    .join('\n');
}

// ---------------------------------------------------------------------------
// Titles the folds prefix their column with
// ---------------------------------------------------------------------------
//
// The plan and the impression are stored as one free-text column each, and each
// is folded as `"<title>: <text>"`. When several items are present the title is
// the only thing distinguishing one line from the next, so it has to stay.

export const ASSESSMENT_TITLE = 'Clinical Impression';
export const PLAN_TITLE = 'Treatment Plan';
export const NOTES_TITLE = 'Clinical Notes';

/**
 * Whether a management entry is a note rather than a plan.
 *
 * The notes have their own column, and the plan fold has to leave them out. It
 * used to fold every management entry into `plan`, so a clinician's note was
 * written into the treatment plan as well as into the notes - twice on the
 * record, and once in a column where it reads as part of the plan. The rule is
 * the same substring test the notes fold uses, in one function, so the two
 * cannot disagree about which entries are which.
 */
export function isNotesEntry(entry: { title: string }): boolean {
  return entry.title.toLowerCase().includes('note');
}

/**
 * Removes one leading `"<title>: "` from a value the fold put there.
 *
 * This exists because the seed and the fold disagreed about who owns the title.
 * The fold writes `"Treatment Plan: Appendicectomy..."`; the seed read that
 * column back as a single entry titled `Treatment Plan` whose **body** was the
 * whole string, title and all. Saving that again produced
 * `"Treatment Plan: Treatment Plan: Appendicectomy..."`, and the next save
 * another one - so every save of a stored consultation added a prefix and pushed
 * the clinician's own words further down the column. Found by reading a saved
 * row back with SQL, after the write that the previous fix had unblocked.
 *
 * Removing it on the way in makes the pair idempotent: a stored value re-seeds
 * and re-saves to itself, whether it was written with the prefix or not, and a
 * second and third save add nothing.
 *
 * Only one prefix is removed, and only when it is the fold's own title: a
 * clinician who genuinely writes "Treatment Plan: ..." at the start of their own
 * notes has that word removed once and then the value stops changing, so the
 * text settles rather than growing.
 */
export function stripTitlePrefix(value: string, title: string): string {
  const prefix = `${title}: `;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

/** The clinical impression: the free-text entries, each under its own title. */
export function foldImpression(entries: DiagnosisEntry[]): string {
  return entries
    .filter((d) => !d.isCoded)
    .map((d) => `${d.title}: ${stripTitlePrefix(d.body, d.title)}`)
    .join('\n');
}

/** The plan, the same shape, and the notes left out: they have their own column. */
export function foldPlan(entries: ManagementEntry[]): string {
  return entries
    .filter((m) => !isNotesEntry(m))
    .map((m) => `${m.title}: ${stripTitlePrefix(m.body, m.title)}`)
    .join('\n');
}

/** The clinical notes, which are never part of the plan. */
export function foldNotes(entries: ManagementEntry[]): string {
  return entries
    .filter(isNotesEntry)
    .map((m) => m.body)
    .join('\n');
}

/** The free-text surgical history, when the Surgery History tab has not claimed the column. */
export function freeTextSurgicalHistory(entries: EntryItem[]): string {
  return entries.find((e) => e.title.toLowerCase().includes('surgical')) ? entryText(entries.find((e) => e.title.toLowerCase().includes('surgical'))!) : '';
}

/**
 * The seven history columns, folded from the titled entries.
 *
 * Which entry feeds which column is decided by the entry's own title, so a
 * doctor can call a section "Presenting Complaint" and have it land in
 * `presenting_complaint` without the form knowing anything about it.
 */
export function foldHistory(entries: EntryItem[]): {
  presentingComplaint: string;
  historyOfPresentingComplaint: string;
  pastMedicalHistory: string;
  surgicalHistory: string;
  drugHistory: string;
  familyHistory: string;
  socialHistory: string;
  allergyHistory: string;
} {
  const pick = (needle: string) => {
    const hit = entries.find((e) => e.title.toLowerCase().includes(needle));
    return hit ? entryText(hit) : '';
  };
  const presenting = pick('presenting');
  return {
    presentingComplaint: presenting || entryText(entries[0] ?? { id: '', title: '', body: '' }),
    historyOfPresentingComplaint: pick('history of presenting'),
    pastMedicalHistory: pick('past medical'),
    surgicalHistory: freeTextSurgicalHistory(entries),
    drugHistory: pick('drug'),
    familyHistory: pick('family'),
    socialHistory: pick('social'),
    allergyHistory: pick('allergy'),
  };
}

export function seedExamEntries(c: Consultation | undefined): EntryItem[] {
  if (!c) return [];
  const pe: PhysicalExamination | undefined = c.physicalExamination;
  const arr: EntryItem[] = [];
  if (pe?.general) arr.push({ id: 'e0', title: 'General Examination', body: pe.general });
  if (pe?.cardiovascular) arr.push({ id: 'e1', title: 'Cardiovascular System', body: pe.cardiovascular });
  if (pe?.respiratory) arr.push({ id: 'e2', title: 'Respiratory System', body: pe.respiratory });
  if (pe?.abdomen) arr.push({ id: 'e3', title: 'Abdomen & GI', body: pe.abdomen });
  if (pe?.neurological) arr.push({ id: 'e4', title: 'Central Nervous System', body: pe.neurological });
  if (pe?.musculoskeletal) arr.push({ id: 'e5', title: 'Musculoskeletal', body: pe.musculoskeletal });
  if (pe?.other) arr.push({ id: 'e6', title: 'Other Systems / Findings', body: pe.other });
  if (c.clinicalFindings) arr.push({ id: 'e7', title: 'Additional Clinical Findings', body: c.clinicalFindings });
  return arr;
}

export function seedSurgeryEntries(c: Consultation | undefined): SurgeryHistoryEntry[] {
  return parseSurgeryHistory(c?.surgicalHistory);
}

export function seedDiagnosisEntries(c: Consultation | undefined): DiagnosisEntry[] {
  // Empty for a visit that has never been consulted. This list used to be
  // seeded with a malaria diagnosis as a worked example, which meant an untouched
  // consultation saved a fabricated diagnosis into the patient's record.
  if (!c) return [];
  const arr: DiagnosisEntry[] = [];
  if (c.assessment) arr.push({ id: 'dx-assess', title: ASSESSMENT_TITLE, body: stripTitlePrefix(c.assessment, ASSESSMENT_TITLE), isCoded: false, code: '', type: 'Primary' });
  for (const d of c.diagnoses ?? []) {
    arr.push({ id: d.id, title: d.description, body: d.description, isCoded: true, code: d.code, type: d.type });
  }
  return arr;
}

export function seedManagementEntries(c: Consultation | undefined): ManagementEntry[] {
  if (!c) return [];
  const arr: ManagementEntry[] = [];
  const { plan, notes } = splitStoredPlan(c.plan);
  if (plan) arr.push({ id: 'm0', title: PLAN_TITLE, body: stripTitlePrefix(plan, PLAN_TITLE), date: c.followUpDate || '', category: 'Therapeutics' });
  // The notes column wins where both hold the same text, because it is the column
  // meant for it. A record written before the plan fold stopped including the
  // notes has them in both places; the plan copy is dropped here, which is what
  // removes the duplication the next time the consultation is saved.
  const noteBody = notes.length ? notes.join('\n') : c.clinicalNotes || '';
  if (noteBody) arr.push({ id: 'm1', title: NOTES_TITLE, body: noteBody, category: 'Notes' });
  return arr;
}

/**
 * Pulls the notes out of a stored plan column.
 *
 * The plan fold used to write the notes entry into the plan as well, so a record
 * saved that way reads:
 *
 *   Treatment Plan: Appendicectomy
 *   Clinical Notes: Patient counselled
 *
 * Both the plan and the notes columns are one free-text field, so on the way back
 * in there is no other way to tell which is which. Only the notes line is lifted
 * out, and only on the module's own notes title: a clinician's plan can contain a
 * line beginning with anything at all, and treating an arbitrary "something: text"
 * as a heading would break their prose into pieces that were not headings.
 */
function splitStoredPlan(stored: string | undefined): { plan: string; notes: string[] } {
  if (!stored) return { plan: '', notes: [] };
  const notes: string[] = [];
  const kept: string[] = [];
  for (const line of stored.split('\n')) {
    const colon = line.indexOf(': ');
    if (colon > 0 && isNotesEntry({ title: line.slice(0, colon) })) {
      notes.push(line.slice(colon + 2));
    } else {
      kept.push(line);
    }
  }
  return { plan: kept.join('\n').trim(), notes };
}

/** All five lists, so a test can assert the whole rule in one call. */
export function seededLists(c: Consultation | undefined): {
  complaint: EntryItem[];
  exam: EntryItem[];
  surgery: SurgeryHistoryEntry[];
  diagnosis: DiagnosisEntry[];
  management: ManagementEntry[];
} {
  return {
    complaint: seedComplaintEntries(c),
    exam: seedExamEntries(c),
    surgery: seedSurgeryEntries(c),
    diagnosis: seedDiagnosisEntries(c),
    management: seedManagementEntries(c),
  };
}
