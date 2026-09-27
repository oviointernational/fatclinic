import type { Visit } from '../types';

/**
 * When a doctor may write to a patient's record.
 *
 * The rule is one sentence: a clinician sees every patient, but may only *enter*
 * anything for a patient a nurse has sent to them. Until then the doctor reads
 * the triage notes and the history and nothing else.
 *
 * This exists as a module because the rule was previously written out four times
 * inside `ConsultationForm.tsx`, as four inline arrays, and the copies had already
 * drifted - one of them included `Admitted` and the other three did not. A gate
 * that is stated in four places is not a gate: changing it means finding all four,
 * and missing one leaves a door open on a medical record. The nurse's "Send to
 * Doctor" button and the doctor's read-only banner are the two ends of the same
 * rule, so they read the same list from here and cannot disagree.
 *
 * A visit the doctor is allowed to write to is one that has reached the doctor.
 * That is a set of states, not a number, and the set is deliberately explicit
 * rather than derived from an ordering, because the ordering is a UI convenience
 * and this is a permission.
 */
export type VisitStatus = Visit['status'];

/**
 * Visit states in which the doctor has the patient and may record findings.
 *
 * `With Doctor` and `Awaiting Physician` are the handoff itself. `In Consultation`
 * is the doctor mid-consultation. `Awaiting Lab`, `Awaiting Pharmacy` and
 * `Awaiting Payment` are *after* the doctor has finished writing the clinical
 * record, and the doctor still has to be able to amend what they wrote - a
 * prescription corrected after the pharmacy is asked for it is the ordinary case,
 * not an exception. `Admitted` is here because admission is itself something the
 * doctor records, from this screen.
 *
 * Everything else is read-only for a doctor: `Awaiting Vitals` and `With Nurse`
 * mean the patient has not been sent yet, and `Treated`, `Discharged` and
 * `Completed` mean the visit is closed.
 */
export const DOCTOR_WRITE_STATUSES: readonly VisitStatus[] = [
  'With Doctor',
  'Awaiting Physician',
  'In Consultation',
  'Awaiting Lab',
  'Awaiting Pharmacy',
  'Awaiting Payment',
  'Admitted',
];

/** True when the doctor may add to this visit's clinical record. */
export function mayDoctorWrite(visit: Visit | null | undefined): boolean {
  return !!visit && DOCTOR_WRITE_STATUSES.includes(visit.status);
}

/**
 * Why the record is read-only, in words a clinician can act on.
 *
 * Returned rather than a bare boolean because the two reasons call for different
 * responses: one means "wait for nursing", the other means "this visit is over".
 * A single "read only" would leave the doctor not knowing which.
 */
export function readOnlyReason(visit: Visit | null | undefined): string | null {
  if (!visit) return 'No visit is selected, so there is nothing to record against.';
  if (mayDoctorWrite(visit)) return null;
  switch (visit.status) {
    case 'Awaiting Vitals':
    case 'With Nurse':
      return 'This patient has not been sent to a doctor yet. A nurse records vitals and triage first, then sends the patient through. You can read everything here; entries are enabled once the patient reaches you.';
    case 'Treated':
    case 'Discharged':
    case 'Completed':
      return `This visit is closed (${visit.status}), so the record is read-only. Start a new visit to record anything further.`;
    default:
      return `This visit is at "${visit.status}", which is not a point where entries are accepted. You can read everything here.`;
  }
}

/**
 * Has a nurse sent this patient to a doctor on their most recent visit?
 *
 * The doctor's queue filters on this, and so does the "With Doctor" tile on the
 * clinical dashboard. Both take the patient's *latest* visit, because a patient
 * whose second visit is waiting for vitals has, in practice, not been sent.
 */
export function isWithDoctor(visits: Visit[]): boolean {
  const latest = latestVisit(visits);
  return mayDoctorWrite(latest);
}

/** The most recent visit for a patient, or undefined if they have never come. */
export function latestVisit(visits: Visit[]): Visit | undefined {
  if (!visits.length) return undefined;
  // Sorted by the same construction `db.getVisits` uses, deliberately rather than
  // by a string comparison that would be equivalent for well-formed input. "The
  // patient's latest visit" has to mean one thing across the app; two orderings
  // that agree today and diverge on a malformed date is the same drift this
  // module was written to remove.
  return [...visits].sort(
    (a, b) =>
      new Date(`${b.visitDate}T${b.visitTime || '00:00'}`).getTime() -
      new Date(`${a.visitDate}T${a.visitTime || '00:00'}`).getTime(),
  )[0];
}
