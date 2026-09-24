import React, { useState } from 'react';
import { Patient, Visit } from '../../types';
import { db } from '../../services/db';
import { useAuth } from '../../context/AuthContext';
import { useSyncDb } from '../../hooks/useSyncDb';
import { 
  Calendar, 
  Plus, 
  Clock, 
  Activity, 
  Stethoscope, 
  FlaskConical, 
  Pill, 
  Receipt, 
  CheckCircle2, 
  ChevronRight,
  ArrowLeft
} from 'lucide-react';

interface VisitTabsViewProps {
  patient: Patient;
  onBack: () => void;
  onOpenConsultation?: (visit: Visit) => void;
  onOpenNursingStation?: (visit: Visit) => void;
}

export const VisitTabsView: React.FC<VisitTabsViewProps> = ({
  patient,
  onBack,
  onOpenConsultation,
  onOpenNursingStation,
}) => {
  const { currentUser } = useAuth();
  useSyncDb();
  const visits = db.getVisits(patient.id);
  // Front Desk cannot create visits in Encounter Tabs (clinical staff only).
  const canCreateVisit = currentUser.role !== 'FRONT_DESK';


  const [activeVisitId, setActiveVisitId] = useState<string>(visits[0]?.id || '');
  const [showNewVisitModal, setShowNewVisitModal] = useState<boolean>(false);
  const [newVisitDate, setNewVisitDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [newVisitType, setNewVisitType] = useState<Visit['visitType']>('Follow-up');
  const [newVisitReason, setNewVisitReason] = useState<string>('Scheduled clinical follow-up & evaluation');

  const activeVisit = visits.find(v => v.id === activeVisitId) || visits[0];

  // Clinical data linked to this visit
  const visitVitals = activeVisit ? db.getVitals(activeVisit.id, patient.id)[0] : undefined;
  const visitConsultation = activeVisit ? db.getConsultation(activeVisit.id) : undefined;
  const visitLabRequests = activeVisit ? db.getLabRequests({ visitId: activeVisit.id }) : [];
  const visitPrescriptions = activeVisit ? db.getPrescriptions(patient.id, activeVisit.id) : [];
  const visitInvoice = activeVisit ? db.getInvoices(patient.id, activeVisit.id)[0] : undefined;
  const settings = db.getSettings();

  const handleCreateRevisit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreateVisit) {
      alert('Front Desk cannot create visits. Please route visit creation via Nursing or Physician.');
      return;
    }
    const created = db.createVisit({
      patientId: patient.id,
      visitDate: newVisitDate,
      visitTime: new Date().toTimeString().slice(0, 5),
      visitType: newVisitType,
      status: 'Awaiting Vitals',
      reasonForVisit: newVisitReason
    }, currentUser);

    setActiveVisitId(created.id);
    setShowNewVisitModal(false);
  };

  return (
    <div className="h-full flex flex-col select-text overflow-hidden">
      {/* Patient Header */}
      <div className="px-6 py-4 bg-white dark:bg-dark-card border-b border-light-border dark:border-dark-border flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-dark-surface text-slate-500"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">
                {patient.firstName} {patient.middleName || ''} {patient.lastName}
              </h2>
              <span className="font-mono text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold">
                {patient.id}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {patient.sex} • {patient.age} yrs • Blood: {patient.bloodGroup || 'N/A'} • Phone: {patient.phone}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {canCreateVisit ? (
            <button
              onClick={() => setShowNewVisitModal(true)}
              className="flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Schedule Revisit Date</span>
            </button>
          ) : (
            <span className="text-[10px] font-bold text-slate-400 px-3 py-2 rounded-xl bg-slate-50 border" title="Front Desk cannot create visits">
              Visit creation: clinical staff only
            </span>
          )}
        </div>
      </div>

      {/* Dynamic Visit Dates Multi-Tabs Bar */}
      <div className="px-6 bg-slate-50 dark:bg-dark-surface/40 border-b border-light-border dark:border-dark-border flex items-center space-x-2 overflow-x-auto py-2">
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mr-2 flex-shrink-0">
          Encounter Tabs:
        </span>

        {visits.map(visit => {
          const isActive = activeVisit?.id === visit.id;

          return (
            <button
              key={visit.id}
              onClick={() => setActiveVisitId(visit.id)}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex-shrink-0 ${
                isActive
                  ? 'bg-white dark:bg-dark-card text-emerald-600 dark:text-emerald-400 shadow-sm border border-emerald-500/30'
                  : 'bg-transparent text-slate-500 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-dark-surface'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>{visit.visitDate}</span>
              <span className={`text-[9px] px-1.5 py-0.2 rounded font-semibold ${
                ['Completed', 'Discharged', 'Treated'].includes(visit.status) ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
              }`}>
                {visit.visitType}
              </span>
            </button>
          );
        })}

        {canCreateVisit && (
          <button
            onClick={() => setShowNewVisitModal(true)}
            className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 border border-dashed border-emerald-300 dark:border-emerald-800 flex-shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Revisit Tab</span>
          </button>
        )}
      </div>

      {/* Selected Visit Details View */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {activeVisit ? (
          <>
            {/* Visit Status Bar */}
            <div className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border flex flex-wrap items-center justify-between gap-3 shadow-sm">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-extrabold text-slate-800 dark:text-white">
                      Encounter Date: {activeVisit.visitDate}
                    </span>
                    <span className="text-xs text-slate-400">({activeVisit.visitTime})</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-dark-surface text-slate-600 dark:text-slate-300">
                      {activeVisit.visitType}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Reason: <strong>{activeVisit.reasonForVisit || 'General Clinical Evaluation'}</strong>
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <span className="text-xs text-slate-400 font-semibold">Status:</span>
                <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                  ['Completed', 'Discharged', 'Treated'].includes(activeVisit.status) 
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' 
                    : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                }`}>
                  {activeVisit.status}
                </span>

                {onOpenConsultation && (
                  <button
                    onClick={() => onOpenConsultation(activeVisit)}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300 hover:bg-rose-100 border border-rose-200 dark:border-rose-900 transition-all"
                  >
                    <Stethoscope className="w-3.5 h-3.5" />
                    <span>Consultation Form</span>
                  </button>
                )}
                {onOpenNursingStation && (
                  <button
                    onClick={() => onOpenNursingStation(activeVisit)}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-300 hover:bg-teal-100 border border-teal-200 dark:border-teal-900 transition-all"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>Record Vitals</span>
                  </button>
                )}
              </div>
            </div>

            {/* Visit Vitals Card */}
            <div className="p-5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm">
              <div className="flex items-center justify-between mb-3 border-b border-light-border dark:border-dark-border pb-2">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center space-x-2">
                  <Activity className="w-4 h-4 text-emerald-500" />
                  <span>Vital Signs Recorded on this Visit</span>
                </h3>
                {visitVitals && (
                  <span className="text-[11px] text-slate-400">
                    Recorded by {visitVitals.nurseName} at {new Date(visitVitals.recordedAt).toLocaleTimeString()}
                  </span>
                )}
              </div>

              {visitVitals ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3">
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-dark-surface text-center">
                    <span className="text-[10px] text-slate-400 uppercase font-bold">Temp</span>
                    <div className="text-sm font-extrabold mt-0.5 text-slate-900 dark:text-white">{visitVitals.temperature}°C</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-dark-surface text-center">
                    <span className="text-[10px] text-slate-400 uppercase font-bold">BP</span>
                    <div className="text-sm font-extrabold mt-0.5 text-slate-900 dark:text-white">{visitVitals.systolicBp}/{visitVitals.diastolicBp}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-dark-surface text-center">
                    <span className="text-[10px] text-slate-400 uppercase font-bold">Pulse</span>
                    <div className="text-sm font-extrabold mt-0.5 text-slate-900 dark:text-white">{visitVitals.pulse} bpm</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-dark-surface text-center">
                    <span className="text-[10px] text-slate-400 uppercase font-bold">Resp Rate</span>
                    <div className="text-sm font-extrabold mt-0.5 text-slate-900 dark:text-white">{visitVitals.respiratoryRate} cpm</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-dark-surface text-center">
                    <span className="text-[10px] text-slate-400 uppercase font-bold">SpO2</span>
                    <div className="text-sm font-extrabold mt-0.5 text-emerald-600">{visitVitals.spo2}%</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-dark-surface text-center">
                    <span className="text-[10px] text-slate-400 uppercase font-bold">Weight / Ht</span>
                    <div className="text-xs font-bold mt-1 text-slate-900 dark:text-white">{visitVitals.weight}kg / {visitVitals.height}m</div>
                  </div>
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center">
                    <span className="text-[10px] text-emerald-700 dark:text-emerald-300 uppercase font-bold">BMI</span>
                    <div className="text-sm font-black text-emerald-800 dark:text-emerald-200 mt-0.5">{visitVitals.bmi}</div>
                    <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 block -mt-0.5">{visitVitals.bmiCategory}</span>
                  </div>
                </div>
              ) : (
                <div className="p-4 text-center text-xs text-slate-400">
                  No vital signs recorded for this visit yet.
                </div>
              )}
            </div>

            {/* Visit Physician Consultation Card */}
            <div className="p-5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm">
              <div className="flex items-center justify-between mb-3 border-b border-light-border dark:border-dark-border pb-2">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center space-x-2">
                  <Stethoscope className="w-4 h-4 text-rose-500" />
                  <span>Physician Consultation Notes</span>
                </h3>
                {visitConsultation && (
                  <span className="text-[11px] text-slate-400">
                    Dr. {visitConsultation.physicianName} • {new Date(visitConsultation.consultationDate).toLocaleString()}
                  </span>
                )}
              </div>

              {visitConsultation ? (
                <div className="space-y-3 text-xs">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-dark-surface">
                      <strong className="text-slate-400 block mb-1">Presenting Complaint:</strong>
                      <p className="text-slate-800 dark:text-slate-100">{visitConsultation.presentingComplaint}</p>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-dark-surface">
                      <strong className="text-slate-400 block mb-1">Clinical Assessment:</strong>
                      <p className="text-slate-800 dark:text-slate-100">{visitConsultation.assessment}</p>
                    </div>
                  </div>

                  <div>
                    <strong className="text-slate-400 block mb-1">Diagnoses (ICD-10):</strong>
                    <div className="flex flex-wrap gap-2">
                      {visitConsultation.diagnoses.map(d => (
                        <span key={d.id} className="px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold text-xs border border-blue-200 dark:border-blue-800">
                          {d.description} ({d.code}) [{d.type}]
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-dark-surface">
                    <strong className="text-slate-400 block mb-1">Management Plan:</strong>
                    <pre className="font-sans text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">{visitConsultation.plan}</pre>
                  </div>
                </div>
              ) : (
                <div className="p-4 text-center text-xs text-slate-400">
                  No consultation notes recorded for this visit yet.
                </div>
              )}
            </div>

            {/* Visit Laboratory & Pharmacy Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Lab Orders on this Visit */}
              <div className="p-5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center space-x-2 mb-3 border-b border-light-border dark:border-dark-border pb-2">
                  <FlaskConical className="w-4 h-4 text-amber-500" />
                  <span>Investigations Ordered ({visitLabRequests.reduce((s, r) => s + r.tests.length, 0)})</span>
                </h4>
                {visitLabRequests.length > 0 ? (
                  <div className="space-y-2">
                    {visitLabRequests.flatMap(r => r.tests.map(test => (
                      <div key={test.id} className="p-2.5 rounded-xl bg-slate-50 dark:bg-dark-surface flex items-center justify-between text-xs">
                        <div>
                          <div className="font-bold text-slate-800 dark:text-slate-200">{test.testName}</div>
                          <span className="text-[10px] text-slate-400">{test.category.replace('_', ' ')}</span>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          test.status === 'Released' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {test.status}
                        </span>
                      </div>
                    )))}
                  </div>
                ) : (
                  <div className="p-4 text-center text-xs text-slate-400">No laboratory tests ordered on this visit.</div>
                )}
              </div>

              {/* Prescriptions on this Visit */}
              <div className="p-5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center space-x-2 mb-3 border-b border-light-border dark:border-dark-border pb-2">
                  <Pill className="w-4 h-4 text-purple-500" />
                  <span>Prescriptions Issued ({visitPrescriptions.reduce((s, r) => s + r.items.length, 0)})</span>
                </h4>
                {visitPrescriptions.length > 0 ? (
                  <div className="space-y-2">
                    {visitPrescriptions.flatMap(r => r.items.map(item => (
                      <div key={item.id} className="p-2.5 rounded-xl bg-slate-50 dark:bg-dark-surface flex items-center justify-between text-xs">
                        <div>
                          <div className="font-bold text-slate-800 dark:text-slate-200">{item.medicationName}</div>
                          <span className="text-[10px] text-slate-400">{item.dosage} • {item.frequency}</span>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          item.dispenseStatus === 'Dispensed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {item.dispenseStatus}
                        </span>
                      </div>
                    )))}
                  </div>
                ) : (
                  <div className="p-4 text-center text-xs text-slate-400">No prescriptions issued on this visit.</div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="text-center p-8 text-slate-400">No visits on record for this patient.</div>
        )}
      </div>

      {/* Schedule New Revisit Date Modal (clinical staff only) */}
      {showNewVisitModal && canCreateVisit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white dark:bg-dark-card border border-light-border dark:border-dark-border rounded-2xl shadow-2xl p-6 select-text animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white mb-1">
              Add New Visit / Revisit Tab
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Select date and reason for {patient.firstName} {patient.lastName}'s visit
            </p>

            <form onSubmit={handleCreateRevisit} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Visit Date:</label>
                <input
                  type="date"
                  required
                  value={newVisitDate}
                  onChange={e => setNewVisitDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Visit Type:</label>
                <select
                  value={newVisitType}
                  onChange={e => setNewVisitType(e.target.value as Visit['visitType'])}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                >
                  <option value="Follow-up">Follow-up</option>
                  <option value="New Visit">New Visit / Acute Episode</option>
                  <option value="Routine">Routine Health Checkup</option>
                  <option value="Emergency">Emergency Evaluation</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Reason for Visit:</label>
                <textarea
                  rows={2}
                  value={newVisitReason}
                  onChange={e => setNewVisitReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewVisitModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-dark-surface text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                >
                  Create Visit Tab
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
