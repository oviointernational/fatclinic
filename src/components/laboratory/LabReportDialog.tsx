/**
 * One laboratory report, shown the same way to everyone who reads one.
 *
 * WHY IT IS A COMPONENT AND NOT A BLOCK IN TWO SCREENS
 * ----------------------------------------------------
 * The nursing station had a details dialog. The doctor's consultation form showed
 * the same investigations as an inline list with no dialog, which is what was
 * asked for. The obvious way to add it is to copy the nurse's markup into the
 * doctor's screen, and that is how two views of one clinical record are built to
 * disagree: they are then edited separately, and the copy is the one that stops
 * matching. This report already had a defect of exactly that shape - a status
 * that contradicted the results beside it, shown by both screens - so the two
 * views are now one component, and neither can be right about the report alone.
 *
 * The status shown is `reportedStatus` rather than the stored one, so it cannot
 * say "Processing" beside a set of released results. It never says "Released"
 * for a report that was not released; when the stored status disagrees with the
 * stored results, `storedStatusNote` shows the stored value as a plain fact
 * rather than leaving a derived label as the only account of the record.
 */
import React from 'react';
import { X, FlaskConical, AlertTriangle, ShieldAlert, User, Clock } from 'lucide-react';
import type { LabRequest, LabResultValue, LabTestOrder } from '../../types';
import {
  enteredRows,
  isFinalReport,
  reportedStatus,
  statusInconsistency,
  storedStatusNote,
} from '../../services/labResults';

interface LabReportDialogProps {
  /** Null closes the dialog, which is how the parent knows it is no longer shown. */
  test: LabTestOrder | null;
  /** The request the test belongs to, when the caller has it: priority and who asked. */
  request?: LabRequest;
  /** Shown so a report lifted out of the record still says whose it is. */
  patientName?: string;
  onClose: () => void;
}

const FLAG_CLASSES: Record<LabResultValue['flag'], string> = {
  Normal: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  Low: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  High: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  Abnormal: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  Critical: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
};

/** Times are stored in UTC and read everywhere else, so they are formatted once, here. */
function moment(value: string | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="p-2 rounded-lg bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="font-bold text-slate-700 dark:text-slate-200 break-words">{value}</div>
    </div>
  );
}

export const LabReportDialog: React.FC<LabReportDialogProps> = ({ test, request, patientName, onClose }) => {
  if (!test) return null;

  const reported = enteredRows(test.results ?? []);
  const final = isFinalReport(test);
  const status = reportedStatus(test);
  const inconsistency = statusInconsistency(test);
  const storedNote = storedStatusNote(test);
  const abnormal = reported.filter((r) => r.flag !== 'Normal');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60" onClick={onClose} />

      <div className="relative bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-2xl border border-light-border dark:border-dark-border max-h-[85vh] flex flex-col">
        <div className="px-5 py-4 border-b border-light-border dark:border-dark-border flex items-start justify-between gap-3 flex-shrink-0">
          <div className="min-w-0">
            <h3 className="font-extrabold text-sm flex items-center space-x-2 text-slate-800 dark:text-slate-100">
              <FlaskConical className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <span className="truncate">{test.testName}</span>
            </h3>
            {patientName && (
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1">
                <User className="w-3 h-3" />
                {patientName}
              </div>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-surface flex-shrink-0" aria-label="Close report">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Status, and what it means for the numbers underneath it. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                final
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
              }`}
            >
              {status}
            </span>
            {test.criticalAlert && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 flex items-center gap-1">
                <ShieldAlert className="w-3 h-3" /> Critical result alert
              </span>
            )}
          </div>

          {request && (
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Requested by {request.physicianName || 'a clinician'}
              {moment(request.requestedAt) ? ` on ${moment(request.requestedAt)}` : ''}
              {request.priority !== 'Routine' ? ` • ${request.priority}` : ''}
            </div>
          )}

          {/* The one thing that must never be guessed at: are these numbers final? */}
          {reported.length > 0 && !final && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300 text-[11px]">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-px" />
              <span>
                <strong>Preliminary — not yet released.</strong> These values have been recorded but
                the laboratory has not released this report. Treat them as a work in progress, not as
                the result of the investigation.
              </span>
            </div>
          )}

          {inconsistency && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300 text-[11px]">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-px" />
              <span>{inconsistency}</span>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            <Field label="Category" value={test.category} />
            <Field label="Sample" value={test.sampleType} />
            <Field label="Collected" value={moment(test.collectedAt)} />
            <Field label="Collected by" value={test.scientistName ?? null} />
            <Field label="Released" value={moment(test.releasedAt)} />
            <Field label="Released by" value={test.verifiedBy ?? null} />
          </div>

          {/* The value the status above was derived from, when it differs. A derived
              label is only trustworthy if the record it came from is still visible. */}
          {storedNote && (
            <div className="text-[10px] text-slate-400 dark:text-slate-500">
              {storedNote} The status shown above is derived from what is recorded against this
              test.
            </div>
          )}

          {reported.length === 0 ? (
            <div className="text-xs text-slate-400 py-4 text-center">
              No results have been recorded for this investigation yet.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                  Results ({reported.length} analyte{reported.length === 1 ? '' : 's'})
                </span>
                {abnormal.length > 0 && (
                  <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400">
                    {abnormal.length} outside the reference interval
                  </span>
                )}
              </div>

              <div className="rounded-xl border border-light-border dark:border-dark-border overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-50 dark:bg-dark-surface text-slate-500 text-[10px] uppercase tracking-wide">
                    <tr>
                      <th className="text-left font-bold px-2 py-1.5">Analyte</th>
                      <th className="text-right font-bold px-2 py-1.5">Result</th>
                      <th className="text-left font-bold px-2 py-1.5">Reference</th>
                      <th className="text-right font-bold px-2 py-1.5">Flag</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-light-border dark:divide-dark-border">
                    {reported.map((r, i) => (
                      <tr key={r.parameterId || i} className="align-top">
                        <td className="px-2 py-1.5 font-semibold text-slate-700 dark:text-slate-200">
                          {r.parameterName}
                        </td>
                        <td className="px-2 py-1.5 text-right font-bold text-slate-900 dark:text-white whitespace-nowrap">
                          {r.value}
                          {r.unit ? <span className="font-normal text-slate-500"> {r.unit}</span> : null}
                        </td>
                        <td className="px-2 py-1.5 text-slate-500">{r.referenceRange || '—'}</td>
                        <td className="px-2 py-1.5 text-right">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${FLAG_CLASSES[r.flag]}`}>
                            {r.flag}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {test.comments && (
            <div className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border p-2.5 rounded-lg">
              <span className="font-bold">Laboratory note:</span> {test.comments}
            </div>
          )}
        </div>

        <div className="px-5 py-3 bg-slate-50 dark:bg-dark-surface rounded-b-2xl flex items-center justify-between gap-2 flex-shrink-0">
          <span className="text-[10px] text-slate-400 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Read-only. The laboratory records results and releases reports.
          </span>
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-bold border border-light-border dark:border-dark-border text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-dark-card">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
