import React, { useMemo, useState } from 'react';
import { LabRequest, LabTestOrder, LabResultValue, LabParameterTemplate } from '../../types';
import { db } from '../../services/db';
import { useCurrentUser } from '../../context/AuthContext';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  FlaskConical,
  Save,
  ShieldAlert,
  Info,
} from 'lucide-react';
import {
  buildRows,
  canRelease,
  criticalRows,
  enteredCount,
  enteredRows,
  flagForValue,
  freeTextRow,
  panelFor,
} from '../../services/labResults';

interface ResultEntryModalProps {
  request: LabRequest;
  testOrder: LabTestOrder;
  onClose: () => void;
  onSave: () => void;
  readOnly?: boolean;
}

const FLAG_STYLES: Record<LabResultValue['flag'], string> = {
  Normal: 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  Low: 'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
  High: 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
  Critical: 'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
  Abnormal: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-300 dark:bg-fuchsia-950/40 dark:text-fuchsia-300 dark:border-fuchsia-800',
};

const FLAG_TEXT: Record<LabResultValue['flag'], string> = {
  Normal: 'text-emerald-700 dark:text-emerald-300',
  Low: 'text-blue-700 dark:text-blue-300',
  High: 'text-amber-700 dark:text-amber-300',
  Critical: 'text-rose-700 dark:text-rose-300',
  Abnormal: 'text-fuchsia-700 dark:text-fuchsia-300',
};

export const ResultEntryModal: React.FC<ResultEntryModalProps> = ({
  request,
  testOrder,
  onClose,
  onSave,
  readOnly = false,
}) => {
  const currentUser = useCurrentUser();
  const testDef = db.getLabInvestigationById(testOrder.testDefinitionId);
  const patient = db.getPatientById(request.patientId);

  // The panel is the investigation's analyte list, in the order it is to be
  // entered and printed. An investigation with no panel - only possible for one an
  // administrator added without a panel - falls back to a single free-text line,
  // and the screen says so rather than pretending that line is the whole test.
  const panel = useMemo(() => panelFor(testDef), [testDef]);
  const hasPanel = panel.length > 0;
  const templateFor = (id: string): LabParameterTemplate | undefined =>
    panel.find((p) => p.id === id);

  const [results, setResults] = useState<LabResultValue[]>(() => {
    if (testOrder.results && testOrder.results.length > 0) return testOrder.results;
    return hasPanel ? buildRows(panel, []) : [freeTextRow(testOrder.testName)];
  });

  const [comments, setComments] = useState(testOrder.comments || '');
  const [criticalAlert, setCriticalAlert] = useState(testOrder.criticalAlert || false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const entered = enteredCount(results);
  const criticals = criticalRows(results);

  const handleValueChange = (idx: number, val: string) => {
    setResults(prev =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        // Recomputing the flag from the value is what stops a potassium of 6.4
        // being released as a normal potassium: previously every flag was a
        // dropdown that started, and stayed, on Normal.
        const template = templateFor(r.parameterId);
        return template
          ? { ...r, value: val, flag: flagForValue(template, val, r.flag) }
          : { ...r, value: val };
      }),
    );
  };

  const handleFlagChange = (idx: number, flag: LabResultValue['flag']) => {
    setResults(prev => prev.map((r, i) => (i === idx ? { ...r, flag } : r)));
  };

  const handleSaveDraft = () => {
    setRefusal(null);
    // Only rows with something in them. An empty analyte is "not done", and
    // storing it as a result with a Normal flag is how a report comes to claim
    // sixteen analytes when two were run.
    db.updateLabTestStatus(request.id, testOrder.id, 'Result Entered', currentUser, enteredRows(results), comments, criticalAlert);
    onSave();
  };

  const handleVerifyAndRelease = () => {
    if (!canRelease(results)) {
      setRefusal(
        'There is nothing to release. Enter at least one result, or save this as a draft and come back to it.',
      );
      return;
    }
    setRefusal(null);
    // A critical analyte released without the alert ticked would reach the
    // physician with nothing in the request to draw their attention to it, so the
    // alert is set from the flags rather than left to a second decision.
    const flagged = criticalAlert || criticals.length > 0;
    db.updateLabTestStatus(request.id, testOrder.id, 'Released', currentUser, enteredRows(results), comments, flagged);
    onSave();
  };

  const selectFor = (r: LabResultValue): LabParameterTemplate | undefined => templateFor(r.parameterId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-5xl max-h-[90vh] flex flex-col bg-white dark:bg-dark-card border border-light-border dark:border-dark-border rounded-3xl shadow-2xl overflow-hidden select-text animate-in fade-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="px-6 py-4 border-b border-light-border dark:border-dark-border flex items-center justify-between bg-slate-50 dark:bg-dark-surface/50">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <FlaskConical className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                  {readOnly ? 'Laboratory Result (Read-Only)' : 'Laboratory Diagnostic Result Entry'}
                </h3>
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-200 dark:bg-dark-surface text-slate-700 dark:text-slate-300">
                  {testOrder.category.replace('_', ' ')}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Investigation: <strong>{testOrder.testName}</strong> • Patient: {patient?.firstName} {patient?.lastName} ({request.patientId})
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-dark-surface transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Specimen & Request Meta */}
        <div className="px-6 py-3 border-b border-light-border dark:border-dark-border bg-amber-50/40 dark:bg-amber-950/20 text-xs flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-slate-500">Specimen Sample:</span> <strong className="text-slate-800 dark:text-slate-200">{testOrder.sampleType}</strong>
          </div>
          {testOrder.collectedAt && (
            <div>
              <span className="text-slate-500">Sample Collected:</span>{' '}
              <strong className="text-slate-800 dark:text-slate-200">
                {new Date(testOrder.collectedAt).toLocaleString()}
                {testOrder.scientistName ? ` by ${testOrder.scientistName}` : ''}
              </strong>
            </div>
          )}
          <div>
            <span className="text-slate-500">Requesting Physician:</span> <strong className="text-slate-800 dark:text-slate-200">{request.physicianName}</strong>
          </div>
          <div>
            <span className="text-slate-500">Priority:</span> <strong className="text-rose-600">{request.priority}</strong>
          </div>
        </div>

        {/* Structured Results Table */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {!hasPanel && (
            <div className="flex items-start space-x-2.5 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs">
              <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-amber-800 dark:text-amber-200">
                <strong>{testOrder.testName}</strong> has no analyte panel in the laboratory
                catalogue, so it can only be recorded as free text below. An administrator can
                add its analytes, units and reference ranges in the laboratory catalogue; until
                then this single box is the whole record of the result.
              </p>
            </div>
          )}

          {hasPanel && (
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400">
              <span>
                {entered} of {results.length} analytes recorded
              </span>
              <span>Only the analytes you fill in are saved and printed.</span>
            </div>
          )}

          <div className="rounded-2xl border border-light-border dark:border-dark-border overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-50 dark:bg-dark-surface/80 border-b border-light-border dark:border-dark-border text-slate-500 uppercase text-[10px] font-extrabold">
                <tr>
                  <th className="py-2.5 px-4" style={{ width: '30%' }}>Parameter</th>
                  <th className="py-2.5 px-4" style={{ width: '30%' }}>Result Value</th>
                  <th className="py-2.5 px-4" style={{ width: '12%' }}>Unit</th>
                  <th className="py-2.5 px-4" style={{ width: '18%' }}>Reference Range</th>
                  <th className="py-2.5 px-4 text-center" style={{ width: '10%' }}>Flag</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-light-border/60 dark:divide-dark-border/60">
                {results.map((res, idx) => {
                  const template = selectFor(res);
                  const options = template?.options ?? [];
                  const isChoice = !!options.length;
                  const longText = template?.resultType === 'text' && !isChoice;
                  return (
                    <tr
                      key={res.parameterId}
                      className={res.value.trim() ? 'hover:bg-slate-50/50 dark:hover:bg-dark-surface/30' : 'bg-slate-50/30 dark:bg-dark-surface/20'}
                    >
                      <td className="py-3 px-4 font-bold text-slate-800 dark:text-slate-100 align-top">
                        {res.parameterName}
                      </td>
                      <td className="py-3 px-4 align-top">
                        {readOnly ? (
                          <span className="font-bold text-slate-900 dark:text-white break-words">
                            {res.value || '—'}
                          </span>
                        ) : isChoice ? (
                          <select
                            value={res.value}
                            onChange={e => handleValueChange(idx, e.target.value)}
                            className="w-full px-3 py-1.5 text-xs font-bold rounded-xl bg-white dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          >
                            <option value="">Not recorded</option>
                            {options.map(o => (
                              <option key={o} value={o}>{o}</option>
                            ))}
                          </select>
                        ) : longText ? (
                          <textarea
                            rows={2}
                            value={res.value}
                            onChange={e => handleValueChange(idx, e.target.value)}
                            placeholder="Describe the finding..."
                            className="w-full px-3 py-1.5 text-xs font-bold rounded-xl bg-white dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                        ) : (
                          <input
                            type="text"
                            inputMode={template?.resultType === 'numeric' ? 'decimal' : 'text'}
                            value={res.value}
                            onChange={e => handleValueChange(idx, e.target.value)}
                            placeholder={template?.resultType === 'numeric' ? '0.00' : 'Enter value / finding...'}
                            className="w-full px-3 py-1.5 text-xs font-bold rounded-xl bg-white dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-500 font-mono align-top">
                        {res.unit && res.unit !== '-' ? res.unit : '—'}
                      </td>
                      <td className="py-3 px-4 text-slate-500 align-top">
                        {res.referenceRange || '—'}
                      </td>
                      <td className="py-3 px-4 text-center align-top">
                        {readOnly ? (
                          <span className={`text-[11px] font-extrabold ${FLAG_TEXT[res.flag]}`}>{res.flag}</span>
                        ) : (
                          <select
                            value={res.flag}
                            onChange={e => handleFlagChange(idx, e.target.value as LabResultValue['flag'])}
                            className={`px-2 py-1 text-[11px] font-extrabold rounded-lg border focus:outline-none ${FLAG_STYLES[res.flag]}`}
                          >
                            <option value="Normal">Normal</option>
                            <option value="Low">Low</option>
                            <option value="High">High</option>
                            <option value="Critical">Critical</option>
                            <option value="Abnormal">Abnormal</option>
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Critical Value Flag */}
          {readOnly ? (
            criticalAlert ? (
              <div className="flex items-center space-x-1.5 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700">
                <AlertTriangle className="w-4 h-4" />
                <span>Critical Result Alert flagged by the laboratory</span>
              </div>
            ) : null
          ) : (
            <label className="flex items-center space-x-2.5 p-3 rounded-xl bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={criticalAlert || criticals.length > 0}
                disabled={criticals.length > 0}
                onChange={e => setCriticalAlert(e.target.checked)}
                className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500"
              />
              <div className="flex items-center space-x-1.5 text-rose-700 dark:text-rose-300 font-bold">
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                <span>Flag as Critical Result Alert (Triggers urgent clinical notification)</span>
              </div>
              {criticals.length > 0 && (
                <span className="ml-auto text-[11px] font-extrabold text-rose-700 dark:text-rose-300">
                  Set automatically: {criticals.map(c => c.parameterName).join(', ')} flagged Critical
                </span>
              )}
            </label>
          )}

          {/* Scientist Comments & Interpretation */}
          <div className="space-y-1.5 text-xs">
            <label className="block font-bold text-slate-700 dark:text-slate-300">
              Laboratory Scientist Comments & Clinical Interpretation:
            </label>
            {readOnly ? (
              <p className="px-3 py-2 rounded-xl bg-slate-50 border text-slate-800 whitespace-pre-wrap">{comments || '—'}</p>
            ) : (
              <textarea
                rows={2}
                value={comments}
                onChange={e => setComments(e.target.value)}
                placeholder="e.g. Microscopic findings, cellular morphology, left shift, culture organism identification..."
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3 border-t border-light-border dark:border-dark-border bg-slate-50 dark:bg-dark-surface/50 flex items-center justify-between gap-3">
          <div className="text-[11px] text-slate-500">
            Scientist: <strong>{currentUser.name}</strong> ({currentUser.role.replace('_', ' ')})
            {refusal && (
              <div className="mt-1 flex items-start space-x-1.5 font-bold text-rose-600 dark:text-rose-400">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
                <span>{refusal}</span>
              </div>
            )}
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            {readOnly ? (
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-slate-200 text-slate-700 hover:bg-slate-300 transition-all"
              >
                Close
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={entered === 0}
                  title={entered === 0 ? 'Enter at least one result before saving a draft' : undefined}
                  className="flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-slate-200 dark:bg-dark-surface text-slate-700 dark:text-slate-200 hover:bg-slate-300 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-slate-200"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Draft</span>
                </button>
                <button
                  type="button"
                  onClick={handleVerifyAndRelease}
                  disabled={!canRelease(results)}
                  title={!canRelease(results) ? 'There is nothing to release yet' : undefined}
                  className="flex items-center space-x-1.5 px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-600"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Verify & Release to Physician</span>
                </button>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
