/**
 * Which of the seven examination columns an entry belongs in.
 *
 * `consultations` stores the examination flattened into seven columns, and the
 * form works in a list of titled entries that a clinician adds through a dialog
 * choosing a body system. So every save has to decide which column each entry
 * belongs to, by reading its title.
 *
 * That decision was made by substring matching:
 *
 *     else if (k.includes('abdomen') || k.includes('gi')) m.abdomen = e.body;
 *     else if (k.includes('nervous') || k.includes('cns')) m.neurological = e.body;
 *
 * while the dialog's own list of systems is General, Cardiovascular,
 * Respiratory, Gastrointestinal, Neurological, Musculoskeletal, Genitourinary,
 * Integumentary, Endocrine, Hematological, Psychiatric. Two of those do not
 * contain either substring: "Gastrointestinal" contains no "gi" and no "abdomen",
 * and "Neurological" contains no "nervous" and no "cns". Both therefore fell
 * through to the `else` branch and were filed under "other", so an abdominal
 * examination and a neurological examination both arrived in the record as
 * "Other Systems / Findings" - while the screen the doctor was looking at said
 * gastrointestinal and neurological. The finding was saved, and misfiled.
 *
 * The fix is not a longer list of substrings. The system is a closed set that
 * the dialog already chose, so it is matched as a word against that set, and the
 * old substrings are kept only as a fallback for titles that predate this
 * (the seeded titles on load, such as "Abdomen & GI" and "Central Nervous
 * System", are not in the dialog's vocabulary).
 */
export const EXAM_COLUMN_KEYS = [
  'general',
  'cardiovascular',
  'respiratory',
  'abdomen',
  'neurological',
  'musculoskeletal',
  'other',
] as const;

export type ExamColumnKey = (typeof EXAM_COLUMN_KEYS)[number];

/**
 * The systems the examination dialog offers, mapped to the column they belong in.
 *
 * Genitourinary, Integumentary, Endocrine, Hematological and Psychiatric have no
 * column of their own and share `other`. That is the schema's shape rather than a
 * decision made here: there are seven columns and eleven systems, and inventing
 * columns would mean a schema change for no clinical gain - these findings are
 * recorded and read, not queried by system.
 */
const SYSTEM_TO_COLUMN: Record<string, ExamColumnKey> = {
  general: 'general',
  cardiovascular: 'cardiovascular',
  respiratory: 'respiratory',
  gastrointestinal: 'abdomen',
  neurological: 'neurological',
  musculoskeletal: 'musculoskeletal',
  genitourinary: 'other',
  integumentary: 'other',
  endocrine: 'other',
  haematological: 'other',
  hematological: 'other',
  psychiatric: 'other',
};

/**
 * Titles that seeded records use, which are not in the dialog's vocabulary.
 * Kept because `initExam` builds its entries from the stored column names, and a
 * record written before this change still has to load into the right column.
 */
const LEGACY_PATTERNS: Array<[RegExp, ExamColumnKey]> = [
  [/general/, 'general'],
  [/cardio/, 'cardiovascular'],
  [/resp/, 'respiratory'],
  [/abdomen|\bgi\b/, 'abdomen'],
  [/nervous|\bcns\b|neuro/, 'neurological'],
  [/musculo/, 'musculoskeletal'],
];

/**
 * The entry that carries additional findings rather than a system.
 *
 * It is a separate column, `clinicalFindings`, and it used to be appended to
 * `other` as well, so the same text was stored twice on every save.
 */
export const ADDITIONAL_FINDINGS_TITLE = 'Additional Clinical Findings';

export function isAdditionalFindings(title: string): boolean {
  return title.toLowerCase().includes('additional');
}

/**
 * The column an entry belongs in, or `other` when the title names no system.
 *
 * `other` is a real answer rather than a fallback: an entry with a title the
 * dialog could not have produced still has to be saved somewhere, and dropping
 * it would lose a finding.
 */
export function classifyExamEntry(title: string): ExamColumnKey {
  const lower = title.toLowerCase();
  // The dialog's titles are `${system} - ${finding}`, so the system is the first
  // word run. Matched as a whole word so a finding that happens to mention a
  // system ("Respiratory rate normal" filed under Cardiovascular) cannot capture
  // the entry.
  const system = lower.split(' - ')[0].trim();
  const direct = SYSTEM_TO_COLUMN[system];
  if (direct) return direct;
  for (const [pattern, column] of LEGACY_PATTERNS) {
    if (pattern.test(lower)) return column;
  }
  return 'other';
}
