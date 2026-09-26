import React, { useState } from 'react';
import { LabRequest, LabTestOrder, LabResultValue } from '../../types';
import { db } from '../../services/db';
import { useCurrentUser } from '../../context/AuthContext';
import { X, CheckCircle2, AlertTriangle, FlaskConical, Save, ShieldAlert } from 'lucide-react';

interface ResultEntryModalProps {
  request: LabRequest;
  testOrder: LabTestOrder;
  onClose: () => void;
  onSave: () => void;
  readOnly?: boolean;
}

export const ResultEntryModal: React.FC<ResultEntryModalProps> = ({
  request,
  testOrder,
  onClose,
  onSave,
  readOnly = false
}) => {
  const currentUser = useCurrentUser();
  const testDef = db.getLabInvestigationById(testOrder.testDefinitionId);
  const patient = db.getPatientById(request.patientId);

  // Initialize parameter results from existing or definition template
  const [results, setResults] = useState<LabResultValue[]>(() => {
    if (testOrder.results && testOrder.results.length > 0) {
      return testOrder.results;
    }
    if (testDef && testDef.parameters.length > 0) {
      return testDef.parameters.map(p => ({
        parameterId: p.id,
        parameterName: p.name,
        value: '',
        unit: p.unit,
        referenceRange: p.referenceRange,
        flag: 'Normal'
      }));
    }
    return [
      {
        parameterId: 'general_result',
        parameterName: testOrder.testName,
        value: '',
        unit: '',
        referenceRange: 'Clinical Norm',
        flag: 'Normal'
      }
    ];
  });

  const [comments, setComments] = useState(testOrder.comments || '');
  const [criticalAlert, setCriticalAlert] = useState(testOrder.criticalAlert || false);

  const handleValueChange = (idx: number, val: string) => {
    setResults(prev => prev.map((r, i) => i === idx ? { ...r, value: val } : r));
  };

  const handleFlagChange = (idx: number, flag: LabResultValue['flag']) => {
    setResults(prev => prev.map((r, i) => i === idx ? { ...r, flag } : r));
  };

  const handleSaveDraft = () => {
    db.updateLabTestStatus(request.id, testOrder.id, 'Result Entered', currentUser, results, comments);
    onSave();
  };

  const handleVerifyAndRelease = () => {
    db.updateLabTestStatus(request.id, testOrder.id, 'Released', currentUser, results, comments);
    onSave();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col bg-white dark:bg-dark-card border border-light-border dark:border-dark-border rounded-3xl shadow-2xl overflow-hidden select-text animate-in fade-in zoom-in-95 duration-200">
        
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
          <div>
            <span className="text-slate-500">Requesting Physician:</span> <strong className="text-slate-800 dark:text-slate-200">{request.physicianName}</strong>
          </div>
          <div>
            <span className="text-slate-500">Priority:</span> <strong className="text-rose-600">{request.priority}</strong>
          </div>
        </div>

        {/* Structured Results Table */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="rounded-2xl border border-light-border dark:border-dark-border overflow-hidden">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-50 dark:bg-dark-surface/80 border-b border-light-border dark:border-dark-border text-slate-500 uppercase text-[10px] font-extrabold">
                <tr>
                  <th className="py-2.5 px-4" style={{ width: '32%' }}>Parameter</th>
                  <th className="py-2.5 px-4" style={{ width: '25%' }}>Result Value</th>
                  <th className="py-2.5 px-4" style={{ width: '13%' }}>Unit</th>
                  <th className="py-2.5 px-4" style={{ width: '18%' }}>Reference Range</th>
                  <th className="py-2.5 px-4 text-center" style={{ width: '12%' }}>Flag</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-light-border/60 dark:divide-dark-border/60">
                {results.map((res, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-dark-surface/30">
                    <td className="py-3 px-4 font-bold text-slate-800 dark:text-slate-100">
                      {res.parameterName}
                    </td>
                    <td className="py-3 px-4">
                      {readOnly ? (
                        <span className="font-bold text-slate-900 dark:text-white">{res.value || '—'}</span>
                      ) : (
                        <input
                          type="text"
                          value={res.value}
                          onChange={e => handleValueChange(idx, e.target.value)}
                          placeholder="Enter value / finding..."
                          className="w-full px-3 py-1.5 text-xs font-bold rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-500 font-mono">
                      {res.unit || '-'}
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      {res.referenceRange}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {readOnly ? (
                        <span className="text-[11px] font-extrabold">{res.flag}</span>
                      ) : (
                        <select
                          value={res.flag}
                          onChange={e => handleFlagChange(idx, e.target.value as any)}
                          className={`px-2 py-1 text-[11px] font-extrabold rounded-lg border focus:outline-none ${
                            res.flag === 'Normal'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                              : res.flag === 'High' || res.flag === 'Critical'
                              ? 'bg-rose-50 text-rose-700 border-rose-300'
                              : res.flag === 'Low'
                              ? 'bg-blue-50 text-blue-700 border-blue-300'
                              : 'bg-amber-50 text-amber-700 border-amber-300'
                          }`}
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
                ))}
              </tbody>
            </table>
          </div>

          {/* Scientist Comments & Interpretation */}
          <div className="space-y-1.5 text-xs">
            <label className="block font-bold text-slate-700 dark:text-slate-300">
              Laboratory Scientist Comments & Clinical Interpretation:
            </label>
            {readOnly ? (
              <p className="px-3 py-2 rounded-xl bg-slate-50 border text-slate-800">{comments || '—'}</p>
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
                checked={criticalAlert}
                onChange={e => setCriticalAlert(e.target.checked)}
                className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500"
              />
              <div className="flex items-center space-x-1.5 text-rose-700 dark:text-rose-300 font-bold">
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                <span>Flag as Critical Result Alert (Triggers urgent clinical notification)</span>
              </div>
            </label>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3 border-t border-light-border dark:border-dark-border bg-slate-50 dark:bg-dark-surface/50 flex items-center justify-between">
          <div className="text-[11px] text-slate-500">
            Scientist: <strong>{currentUser.name}</strong> ({currentUser.role.replace('_', ' ')})
          </div>

          <div className="flex items-center space-x-2">
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
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-200 dark:bg-dark-surface text-slate-700 dark:text-slate-200 hover:bg-slate-300 transition-all"
                >
                  Save Draft
                </button>
                <button
                  type="button"
                  onClick={handleVerifyAndRelease}
                  className="flex items-center space-x-1.5 px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md transition-all"
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
