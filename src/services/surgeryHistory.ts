/**
 * The Surgery History tab, and the one text column it has to live in.
 *
 * `consultations.surgical_history` is a single `TEXT` column. The tab is not: each
 * surgery has a date, a hospital, a procedure and notes, and a clinician reads
 * them as four separate things. So the list is serialised to one line per
 * surgery and parsed back on load.
 *
 * This was previously not serialised at all. The tab kept its entries in React
 * state, `handleSaveConsultation` never read that state, and instead looked for a
 * *complaint* entry whose title happened to contain the word "surgical":
 *
 *     const surgicalVal = complaintEntries.find(x => x.title.toLowerCase().includes('surgical'))?.body || '';
 *
 * So a doctor could fill in the Surgery History tab, press Save, watch it say
 * "Saved!", and the operations they had just written down would be gone. The tab
 * also never reloaded, because there was nothing to load from.
 *
 * The format is one surgery per line, four pipe-separated fields, with the notes
 * last so they may themselves contain pipes:
 *
 *     2010-04-02 | Lagos University Teaching Hospital | Appendicectomy | Recurrence in 2018
 *
 * A line that does not have four fields is not one of ours. It is kept verbatim
 * in the notes of a single entry rather than being discarded, because the column
 * is also reachable as free text from the Complaint & History tab, and text a
 * clinician typed must survive a round trip whether or not this module
 * understands it.
 */
export interface SurgeryHistoryEntry {
  id: string;
  /** YYYY-MM-DD, or '' when the clinician did not record one. */
  date: string;
  hospital: string;
  surgeryType: string;
  notes: string;
}

const FIELD = ' | ';

/** Serialise the list into the single column. An empty list is an empty string. */
export function formatSurgeryHistory(entries: SurgeryHistoryEntry[]): string {
  return entries
    .filter((e) => e.surgeryType.trim() !== '')
    .map((e) =>
      [e.date.trim(), e.hospital.trim(), e.surgeryType.trim(), e.notes.trim()].join(FIELD),
    )
    .join('\n');
}

/**
 * Read the column back into the list.
 *
 * Returns an empty list for empty or absent text, which is what the tab wants
 * before anything has been recorded.
 */
export function parseSurgeryHistory(raw: string | null | undefined): SurgeryHistoryEntry[] {
  if (!raw || !raw.trim()) return [];
  const out: SurgeryHistoryEntry[] = [];
  raw
    .split('\n')
    // The line is NOT trimmed here, only tested. Trimming it destroys the
    // positions the format depends on: a surgery recorded without a date
    // serialises as " |  | Appendicectomy | ", and trimming the line turns the
    // leading empty date into a bare "|" that the separator no longer splits on,
    // so the entry comes back as one unrecognised line with the separators still
    // in its text - and re-saving it writes those separators back out again.
    // The date, hospital and notes are trimmed individually instead, which is
    // where trimming actually belongs.
    .filter((line) => line.trim() !== '')
    .forEach((line, index) => {
      const parts = line.split(FIELD);
      if (parts.length >= 4) {
        out.push({
          id: `surg-${index + 1}`,
          date: parts[0].trim(),
          hospital: parts[1].trim(),
          surgeryType: parts[2].trim(),
          notes: parts.slice(3).join(FIELD).trim(),
        });
      } else {
        // Not our format. Kept, not dropped.
        out.push({ id: `surg-${index + 1}`, date: '', hospital: '', surgeryType: line, notes: '' });
      }
    });
  return out;
}

/**
 * True when the stored text is a list this module wrote.
 *
 * Used to decide whether the Complaint & History tab should also show the
 * surgical history as one of its entries. It always used to, which after this
 * change would show the same operations twice - once structured on the Surgery
 * History tab and once as a block of text on the Complaint tab - and editing
 * either copy would silently discard the other.
 */
export function isStructuredSurgeryHistory(raw: string | null | undefined): boolean {
  if (!raw || !raw.trim()) return false;
  return raw
    .split('\n')
    .filter((line) => line.trim() !== '')
    .every((line) => line.split(FIELD).length >= 4);
}
