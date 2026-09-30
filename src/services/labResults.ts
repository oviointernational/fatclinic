/**
 * Laboratory result entry: the rules, with no React in them.
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * Result entry is the one screen in the clinic where a wrong value is not
 * embarrassing but dangerous, and every rule that decides what gets recorded -
 * which analytes a panel has, whether a number is inside its reference interval,
 * what a "Positive" result flags as, which rows are worth saving at all - was
 * living inside a modal component as `useState` and a `<tr>`. Rules that decide
 * clinical flags belong where they can be tested directly, so they are here and
 * `scripts/sync-selftest.mjs` exercises them against the seeded catalogue.
 *
 * THE DEFECT THIS REPLACES
 * ------------------------
 * A Full Blood Count is sixteen analytes. It was being recorded in one free-text
 * box because the panel it should have been recorded against was empty, and an
 * empty panel is invisible: the screen had nothing to render but a single line,
 * every flag defaulted to "Normal" whatever was typed into it, and a potassium of
 * 6.4 would have been released to a physician as a normal potassium.
 *
 * So the three things this module guarantees:
 *
 *   1. A test with a panel is recorded one analyte at a time, each against its
 *      own unit, its own printed range and its own flag.
 *   2. A number is flagged from its reference interval rather than defaulting to
 *      Normal. Nothing is ever silently recorded as normal because nobody
 *      touched a dropdown that was already set to it.
 *   3. Only rows with something in them are saved. An empty analyte is "not
 *      done", and storing it as a result with a Normal flag is how a report comes
 *      to claim sixteen analytes when two were run.
 */
import type { LabInvestigationDefinition, LabParameterTemplate, LabResultValue } from '../types';

export type LabFlag = LabResultValue['flag'];

/**
 * The panel for an investigation, in the order it is to be entered and printed.
 *
 * Ordered by `sort_order` rather than left to the database. Without an ORDER BY
 * Postgres returns rows in whatever order it finds them, so a report could list
 * its analytes differently on two consecutive runs of the same test - which is
 * also why `sort_order` was added to `lab_parameters`.
 */
export function panelFor(
  definition: LabInvestigationDefinition | undefined,
): LabParameterTemplate[] {
  if (!definition) return [];
  return [...(definition.parameters ?? [])].sort(
    (a, b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100) || a.id.localeCompare(b.id),
  );
}

/** The single row used by a test whose catalogue entry carries no panel. */
export function freeTextRow(testName: string): LabResultValue {
  return {
    parameterId: 'general_result',
    parameterName: testName,
    value: '',
    unit: '',
    referenceRange: 'Clinical Norm',
    flag: 'Normal',
  };
}

/**
 * The rows to edit: the panel, with anything already recorded filled in.
 *
 * Recorded rows whose parameter is no longer on the panel are kept rather than
 * dropped. A panel edited after a result was entered must not delete that
 * result from the record - it hides a finding that was actually observed. They
 * are appended after the panel so they are still visible on the report.
 */
export function buildRows(
  parameters: LabParameterTemplate[],
  existing: LabResultValue[] | undefined,
): LabResultValue[] {
  const saved = new Map((existing ?? []).map((r) => [r.parameterId, r]));
  const panelIds = new Set(parameters.map((p) => p.id));

  const rows = parameters.map((p) => {
    const previous = saved.get(p.id);
    const value = previous?.value ?? '';
    return {
      parameterId: p.id,
      parameterName: previous?.parameterName || p.name,
      value,
      // The panel is the authority for the unit and the printed range, not the
      // value saved with the result: a range corrected in the catalogue should
      // change what the screen shows, and a result already reported keeps the
      // row it was reported on.
      unit: p.unit,
      referenceRange: p.referenceRange,
      flag: previous?.flag ?? initialFlag(p, value),
    } as LabResultValue;
  });

  for (const orphan of saved.values()) {
    if (panelIds.has(orphan.parameterId)) continue;
    rows.push(orphan);
  }
  return rows;
}

/**
 * The flag a parameter starts on.
 *
 * Blank means "not entered", and an unentered analyte must not carry a Normal
 * flag that reads as a finding. It is recorded as Normal only because the column
 * is NOT NULL over a fixed set - so the honest thing is that the flag is
 * recomputed the moment a value arrives, and a row that was never filled in is
 * never saved in the first place (see `enteredRows`).
 */
function initialFlag(parameter: LabParameterTemplate, value: string): LabFlag {
  if (!value.trim()) return 'Normal';
  return flagForValue(parameter, value, 'Normal');
}

/**
 * The flag a value implies.
 *
 *   - numeric with both bounds: outside them is Low or High.
 *   - numeric with one bound: only that side can be out of range.
 *   - numeric with no bounds, or a value that is not a plain number ("Trace",
 *     "<0.5", "Positive"): no automatic judgement, so the current flag stands.
 *     Inventing one here would put a fabricated Normal on a result nobody
 *     measured against an interval.
 *   - select or reactive: the first option is the normal or negative value, so
 *     anything else is Abnormal.
 *
 * `critical` is never returned. A critical result is a clinical judgement about
 * how far outside the interval a value is and what it means for this patient -
 * the scientist flags it, and the screen proposes nothing here.
 */
export function flagForValue(
  parameter: LabParameterTemplate,
  value: string,
  current: LabFlag,
): LabFlag {
  const text = value.trim();
  if (!text) return current;

  if (parameter.resultType === 'numeric') {
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) return current;
    const { refLow, refHigh } = parameter;
    if (refLow === null || refLow === undefined) {
      if (refHigh === null || refHigh === undefined) return current;
      return parsed > refHigh ? 'High' : 'Normal';
    }
    if (refHigh === null || refHigh === undefined) {
      return parsed < refLow ? 'Low' : 'Normal';
    }
    if (parsed < refLow) return 'Low';
    if (parsed > refHigh) return 'High';
    return 'Normal';
  }

  if (parameter.resultType === 'select' || parameter.resultType === 'reactive') {
    const options = parameter.options ?? [];
    if (!options.length) return current;
    return text === options[0] ? 'Normal' : 'Abnormal';
  }

  return current;
}

/** The rows worth saving: those with something actually entered. */
export function enteredRows(rows: LabResultValue[]): LabResultValue[] {
  return rows
    .filter((r) => r.value.trim() !== '')
    .map((r) => ({ ...r, value: r.value.trim() }));
}

export function enteredCount(rows: LabResultValue[]): number {
  return enteredRows(rows).length;
}

/** The analytes a scientist has marked critical, for the release-time warning. */
export function criticalRows(rows: LabResultValue[]): LabResultValue[] {
  return rows.filter((r) => r.flag === 'Critical' && r.value.trim() !== '');
}

/**
 * Whether a result may be released.
 *
 * Releasing an empty report is the failure this guards: the physician sees a
 * "released" investigation, the invoice line is settled, and there is nothing in
 * it. A partial panel is allowed - some of a coagulation profile may genuinely
 * not have been run - but nothing at all is not a report.
 */
export function canRelease(rows: LabResultValue[]): boolean {
  return enteredRows(rows).length > 0;
}

// ---------------------------------------------------------------------------
// The workflow transitions
// ---------------------------------------------------------------------------

/**
 * The fields a transition decides, and nothing else.
 *
 * Deliberately a subset of `LabTestOrder` with no index signature, so that
 * applying a change returns the caller's own type rather than a widened copy of
 * it: `applyStatusChange` is generic, and the test it produces is still a
 * `LabTestOrder` with every field it started with.
 */
export interface LabTestUnderWork {
  status: string;
  results?: LabResultValue[];
  comments?: string;
  criticalAlert?: boolean;
  collectedAt?: string;
  scientistId?: string;
  scientistName?: string;
  verifiedBy?: string;
  releasedAt?: string;
}

export interface StatusChangeInput {
  /** Omitted means "leave whatever is there alone" - not "clear it". */
  results?: LabResultValue[];
  comments?: string;
  criticalAlert?: boolean;
  /** Whoever is making the change, recorded for the audit trail. */
  user: { id: string; name: string };
  /** Injected so a test can be told the difference between two clicks. */
  now?: string;
}

/**
 * The status a laboratory test advances to, and which fields that touches.
 *
 * WHY THE DERIVATION LIVES HERE
 * -----------------------------
 * Three fields were written by nobody, and the reason is that they were decided
 * inline in a component method where nothing could check them:
 *
 *   - `collectedAt`, the moment the specimen was drawn. The column has been in the
 *     schema from the start and no code path has ever written it, so the first
 *     thing a laboratory disputes - when was this sample taken, and by whom - was
 *     blank on every request the clinic has ever run.
 *   - `criticalAlert`, which used to be a checkbox that set a state and dropped it,
 *     so a potassium of 6.4 was released with the urgent-notification flag off.
 *   - `scientistId` / `scientistName`, set only for a Medical Laboratory Scientist,
 *     so a specimen collected by a nurse recorded nobody at all.
 *
 * A rule that decides what gets written to a clinical record belongs next to the
 * other such rules, where a test can hold it to the schema.
 *
 * The one judgement here: `collectedAt` is stamped on the transition into
 * "Sample Collected" and on "Processing" - the two states that both mean the
 * specimen is in the laboratory - and is never stamped again. It is also not
 * overwritten if one is already recorded, because a test that goes back to
 * processing must still show when it was drawn rather than when it was reopened.
 */
export function applyStatusChange<T extends LabTestUnderWork>(
  test: T,
  status: string,
  input: StatusChangeInput,
): T {
  const now = input.now ?? new Date().toISOString();
  const specimenInHand = status === 'Sample Collected' || status === 'Processing';
  return {
    ...test,
    status,
    results: input.results !== undefined ? input.results : test.results,
    comments: input.comments !== undefined ? input.comments : test.comments,
    criticalAlert: input.criticalAlert !== undefined ? input.criticalAlert : test.criticalAlert,
    collectedAt: specimenInHand ? (test.collectedAt ?? now) : test.collectedAt,
    scientistId: input.user.id,
    scientistName: input.user.name,
    verifiedBy: status === 'Released' ? input.user.name : test.verifiedBy,
    releasedAt: status === 'Released' ? now : test.releasedAt,
  } as T;
}

/**
 * What the audit log says about a status change.
 *
 * A release that logs only "status changed to Released" cannot be checked against
 * anything: a physician disputing a result opens the log and finds no record of
 * which analytes were released or which of them were abnormal. So the analytes
 * are named, the flags with them, and a raised critical alert is stated outright.
 */
export function statusAuditDetail(
  test: { testName?: string; results?: LabResultValue[]; criticalAlert?: boolean } | undefined,
  status: string,
): string {
  const parts = [`Investigation ${test?.testName || '(unnamed)'} status changed to ${status}.`];
  const reported = enteredRows(test?.results ?? []);
  if ((status === 'Released' || status === 'Result Entered') && reported.length > 0) {
    parts.push(`${reported.length} analyte${reported.length === 1 ? '' : 's'} recorded.`);
    const flagged = reported.filter((r) => r.flag !== 'Normal');
    if (flagged.length > 0) {
      parts.push(`Flagged: ${flagged.map((r) => `${r.parameterName} ${r.flag}`).join('; ')}.`);
    }
    if (test?.criticalAlert) parts.push('Critical result alert raised.');
  }
  return parts.join(' ');
}