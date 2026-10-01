/**
 * Which encounters are in each stage of the doctor-and-nursing flow, for a
 * chosen stretch of time.
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * It was a set of functions inside `ClinicalDashboard.tsx`, hard-wired to today:
 * every group was `visitDate === today`, in a UTC string comparison, so on this
 * machine at 00:30 local "today's flow" was yesterday's.
 *
 * Two things made it untestable. It lived in a `.tsx` file, which Node cannot
 * import, and it read the date itself instead of being handed one - so there was
 * no way to ask it about any day other than the day the test happened to run.
 * Both are why a range could not be added safely to it: there was nowhere to
 * prove the arithmetic.
 *
 * It is plain data and plain functions now, so the self-test can ask about a
 * specific range and be certain of the answer.
 *
 * A STATUS IS NOT A HISTORY
 * -------------------------
 * The important thing to be honest about, and the reason the ward census is
 * treated differently from every other group.
 *
 * `visit.status` is where the encounter is NOW, not where it has been. So these
 * cards answer "how many encounters are in this state, dated inside this range",
 * which for today reads as today's flow - but for a month reads as every
 * encounter from that month that has not moved on since.
 *
 * That is a true answer to a question worth asking, but it is not "how many
 * patients passed through this stage in October". Nothing here records when a
 * status changed, so that number cannot be produced from what is stored, and
 * inventing one would be worse than saying what is actually counted. The screen
 * words it as "encounters with this status" for exactly this reason.
 *
 * `admitted` is the case that matters clinically. A patient admitted on Tuesday
 * is still in a bed on Thursday, so the ward census must NOT be narrowed by a
 * date range: filtering "who is in a ward now" down to visits dated today would
 * report an empty ward while patients are lying in it. Anyone believing that
 * number could stop looking for them. It therefore ignores the range, and the
 * screen says so in words rather than letting the count quietly disagree with
 * the filter above it.
 */
import type { Visit } from '../types';
import { parseStoredDate, withinWindow, type DateWindow } from './dateRange';

export interface ClinicalFlowGroup {
  id: string;
  label: string;
  statuses: Visit['status'][];
  /**
   * Whether the chosen date range narrows this group. False only for the ward
   * census, and the reason is above.
   */
  followsRange: boolean;
}

/**
 * The flow groups, in the order the dashboard shows them.
 *
 * `discharged` covers three terminal statuses on purpose: 'Treated', 'Discharged'
 * and 'Completed' are all ways the same outcome gets recorded, and splitting them
 * would report three smaller numbers for one question.
 */
export const CLINICAL_FLOW_GROUPS: ClinicalFlowGroup[] = [
  { id: 'triage', label: 'Awaiting Triage', statuses: ['Awaiting Vitals'], followsRange: true },
  { id: 'nursing', label: 'With Nurse', statuses: ['With Nurse'], followsRange: true },
  { id: 'doctor', label: 'With Doctor', statuses: ['With Doctor', 'Awaiting Physician'], followsRange: true },
  { id: 'consulting', label: 'In Consultation', statuses: ['In Consultation'], followsRange: true },
  { id: 'lab', label: 'Awaiting Lab', statuses: ['Awaiting Lab'], followsRange: true },
  { id: 'pharmacy', label: 'Awaiting Pharmacy', statuses: ['Awaiting Pharmacy'], followsRange: true },
  { id: 'payment', label: 'Awaiting Payment', statuses: ['Awaiting Payment'], followsRange: true },
  // The ward census. Ignores the range on purpose: see the note above.
  { id: 'admitted', label: 'Admitted / In Ward', statuses: ['Admitted'], followsRange: false },
  { id: 'discharged', label: 'Discharged / Treated', statuses: ['Discharged', 'Treated', 'Completed'], followsRange: true },
];

/** The one group whose count is not narrowed by the date range. */
export const WARD_CENSUS_GROUP_ID = 'admitted';

/** The groups the date range applies to, i.e. everything except the ward census. */
export const RANGED_FLOW_GROUPS = CLINICAL_FLOW_GROUPS.filter(g => g.followsRange);

export function findFlowGroup(groupId: string): ClinicalFlowGroup | undefined {
  return CLINICAL_FLOW_GROUPS.find(g => g.id === groupId);
}

/** Whether one encounter belongs in one group, under one window. */
export function visitInGroup(
  visit: Visit,
  group: ClinicalFlowGroup,
  window: DateWindow | null,
  ward?: string | null,
): boolean {
  if (!group.statuses.includes(visit.status)) return false;
  // Ward narrowing applies only to the census: 'With Doctor' has no ward, so
  // applying it there would hide every doctor-queue patient.
  if (group.id === WARD_CENSUS_GROUP_ID && ward && visit.ward !== ward) return false;
  if (group.followsRange && !withinWindow(visit.visitDate, window)) return false;
  return true;
}

/**
 * Patient ids in one group, under one window.
 *
 * Deduplicated by patient, because the question a card asks is "how many
 * patients", and one patient with two encounters in the same state is one card.
 */
export function clinicalGroupPatientIds(
  visits: Visit[],
  groupId: string,
  window: DateWindow | null,
  ward?: string | null,
): Set<string> {
  const group = findFlowGroup(groupId);
  const ids = new Set<string>();
  if (!group) return ids;
  for (const v of visits) {
    if (visitInGroup(v, group, window, ward)) ids.add(v.patientId);
  }
  return ids;
}

/** Every group's count under one window. */
export function clinicalGroupCounts(visits: Visit[], window: DateWindow | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of CLINICAL_FLOW_GROUPS) {
    out[g.id] = clinicalGroupPatientIds(visits, g.id, window).size;
  }
  return out;
}

/**
 * Everyone in a ward, by ward code.
 *
 * Never narrowed by the date range, for the reason in the header. An unreadable
 * ward is stored as 'UNSPECIFIED' and shown under that name rather than dropped,
 * so the census adds up to the admitted count.
 */
export function admittedByWard(visits: Visit[]): Array<{ ward: string; count: number }> {
  const census = findFlowGroup(WARD_CENSUS_GROUP_ID);
  const map = new Map<string, number>();
  for (const v of visits) {
    if (!census || !visitInGroup(v, census, null)) continue;
    const w = v.ward || 'UNSPECIFIED';
    map.set(w, (map.get(w) || 0) + 1);
  }
  return [...map.entries()]
    .map(([ward, count]) => ({ ward, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Encounters whose date cannot be read, so a count can admit what it dropped.
 *
 * `withinWindow` refuses a date it cannot parse, so a visit saved with a broken
 * date falls out of every range silently. That is the right default - guessing a
 * date puts a patient in the wrong day's flow - but the number is reported
 * rather than swallowed.
 */
export function countUnreadableVisitDates(visits: Visit[]): number {
  return visits.filter(v => parseStoredDate(v.visitDate) === null).length;
}
