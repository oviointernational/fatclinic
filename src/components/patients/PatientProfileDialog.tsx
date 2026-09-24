import React, { useState } from 'react';
import { Patient, Visit, Vitals, Consultation, LabRequest, Prescription, Invoice } from '../../types';
import { db } from '../../services/db';
import { pdfService } from '../../services/pdfService';
import { 
  X, 
  Download, 
  Activity, 
  FlaskConical, 
  Pill, 
  Stethoscope, 
  Receipt, 
  FileText, 
  Calendar, 
  AlertTriangle, 
  CheckCircle2, 
  Printer, 
  Clock, 
  ShieldAlert
} from 'lucide-react';

interface PatientProfileDialogProps {
  patient: Patient | null;
  onClose: () => void;
  onOpenAuditLog: (patientId: string, patientName: string) => void;
  onOpenVisitTabs: (patient: Patient) => void;
}

type ProfileTab = 'overview' | 'lab' | 'pharmacy' | 'nursing' | 'billing' | 'documents';

export const PatientProfileDialog: React.FC<PatientProfileDialogProps> = ({
  patient,
  onClose,
  onOpenAuditLog,
  onOpenVisitTabs
}) => {
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');
  const [selectedVisitId, setSelectedVisitId] = useState<string>('');

  // keep hooks unconditional — sync selected visit when patient changes
  React.useEffect(() => {
    if (patient) {
      const v = db.getVisits(patient.id);
      if (v.length > 0 && !v.find(x => x.id === selectedVisitId)) {
        setSelectedVisitId(v[0].id);
      }
      if (v.length === 0) setSelectedVisitId('');
      setActiveTab('overview');
    } else {
      setSelectedVisitId('');
    }
  }, [patient?.id]);

  if (!patient) return null;

  const visits = db.getVisits(patient.id);
  // fallback to first visit if selectedVisitId stale
  const effectiveVisitId = visits.find(v => v.id === selectedVisitId)?.id || visits[0]?.id || '';
  const vitalsList = db.getVitals(undefined, patient.id);
  const consultations = db.getPatientConsultations(patient.id);
  const labRequests = db.getLabRequests({ patientId: patient.id });
  const prescriptions = db.getPrescriptions(patient.id);
  const invoices = db.getInvoices(patient.id);
  const settings = db.getSettings();

  const selectedVisit = visits.find(v => v.id === effectiveVisitId) || visits[0];
  const visitVitals = selectedVisit ? db.getVitals(selectedVisit.id, patient.id)[0] : vitalsList[0];
  const visitConsultation = selectedVisit ? db.getConsultation(selectedVisit.id) : consultations[0];
  const visitLabs = selectedVisit ? db.getLabRequests({ visitId: selectedVisit.id }) : [];
  const visitRx = selectedVisit ? db.getPrescriptions(patient.id, selectedVisit.id) : [];
  const visitInvoice = selectedVisit ? db.getInvoices(patient.id, selectedVisit.id)[0] : undefined;

  const sideNavButtons: Array<{ id: ProfileTab; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: 'Overview', icon: <Activity className="w-5 h-5" /> },
    { id: 'lab', label: 'Laboratory', icon: <FlaskConical className="w-5 h-5" /> },
    { id: 'pharmacy', label: 'Pharmacy', icon: <Pill className="w-5 h-5" /> },
    { id: 'nursing', label: 'Nursing', icon: <Stethoscope className="w-5 h-5" /> },
    { id: 'billing', label: 'Billing', icon: <Receipt className="w-5 h-5" /> },
    { id: 'documents', label: 'Documents', icon: <FileText className="w-5 h-5" /> }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-3 md:p-6 select-text animate-in fade-in duration-200">
      <div className="w-full max-w-6xl h-[90vh] flex flex-col bg-white dark:bg-dark-card border border-light-border dark:border-dark-border rounded-3xl shadow-2xl overflow-hidden">
        
        {/* Top Header Bar */}
        <div className="px-6 py-3 border-b border-light-border dark:border-dark-border flex items-center justify-between bg-slate-50 dark:bg-dark-surface/50">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xl font-bold">
              {patient.sex === 'Female' ? '👩' : '👨'}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                  {patient.firstName} {patient.middleName || ''} {patient.lastName}
                </h3>
                <span className="font-mono text-xs px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 font-bold border border-emerald-200 dark:border-emerald-800">
                  {patient.id}
                </span>
                <span className="text-xs text-slate-500">
                  {patient.sex} • {patient.age} yrs • Blood: {patient.bloodGroup || 'N/A'}
                </span>
              </div>
              <div className="flex items-center space-x-2 mt-0.5">
                {patient.allergies.length > 0 ? (
                  <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 rounded">
                    ⚠️ Allergies: {patient.allergies.join(', ')}
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-400">No known allergies</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* View Visits Tabs Button */}
            <button
              onClick={() => onOpenVisitTabs(patient)}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 border border-emerald-200 dark:border-emerald-800 transition-all"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Visit Tabs ({visits.length})</span>
            </button>

            {/* Audit Log Button */}
            <button
              onClick={() => onOpenAuditLog(patient.id, `${patient.firstName} ${patient.lastName}`)}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-dark-surface text-slate-700 dark:text-slate-200 hover:bg-slate-200 transition-all"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
              <span>Immutable Log</span>
            </button>

            {/* Export as PDF */}
            <button
              onClick={() => pdfService.exportPatientProfile(patient)}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Export as PDF</span>
            </button>

            {/* Close */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-dark-surface transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Dialog Body with 10% side flat icon strip and 90% content container */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* 10% Flat Icon Side Strip */}
          <div className="w-[10%] min-w-[70px] max-w-[85px] h-full bg-slate-50 dark:bg-dark-surface/40 border-r border-light-border dark:border-dark-border py-4 flex flex-col items-center space-y-3">
            {sideNavButtons.map(btn => {
              const isActive = activeTab === btn.id;

              return (
                <button
                  key={btn.id}
                  onClick={() => setActiveTab(btn.id)}
                  title={btn.label}
                  className={`w-12 h-12 rounded-2xl flex flex-col items-center justify-center transition-all ${
                    isActive
                      ? 'bg-emerald-600 text-white shadow-md scale-105 ring-2 ring-emerald-400/50'
                      : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-dark-surface'
                  }`}
                >
                  {btn.icon}
                  <span className="text-[9px] font-bold mt-1 tracking-tight truncate max-w-[48px]">
                    {btn.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 90% Content Area */}
          <div className="flex-1 h-full overflow-y-auto p-6 bg-white dark:bg-dark-card">
            
            {/* 1. OVERVIEW TAB */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* Biodata & Demographics Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-dark-surface/40 border border-light-border dark:border-dark-border">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Demographics</span>
                    <div className="mt-2 space-y-1 text-xs">
                      <div><span className="text-slate-400">DOB:</span> <strong className="text-slate-800 dark:text-slate-200">{patient.dob}</strong></div>
                      <div><span className="text-slate-400">Genotype / Blood:</span> <strong className="text-slate-800 dark:text-slate-200">{patient.genotype || 'N/A'} • {patient.bloodGroup || 'N/A'}</strong></div>
                      <div><span className="text-slate-400">Occupation:</span> <strong className="text-slate-800 dark:text-slate-200">{patient.occupation || 'Not specified'}</strong></div>
                      <div><span className="text-slate-400">Registered:</span> <span className="text-slate-600 dark:text-slate-300">{new Date(patient.registeredAt).toLocaleDateString()}</span></div>
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-dark-surface/40 border border-light-border dark:border-dark-border">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Contact & Address</span>
                    <div className="mt-2 space-y-1 text-xs">
                      <div><span className="text-slate-400">Phone:</span> <strong className="text-slate-800 dark:text-slate-200">{patient.phone}</strong></div>
                      <div><span className="text-slate-400">Email:</span> <span className="text-slate-600 dark:text-slate-300">{patient.email || 'N/A'}</span></div>
                      <div><span className="text-slate-400">Address:</span> <span className="text-slate-600 dark:text-slate-300 text-[11px] block">{patient.address}</span></div>
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-dark-surface/40 border border-light-border dark:border-dark-border">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Emergency Contact</span>
                    <div className="mt-2 space-y-1 text-xs">
                      <div><span className="text-slate-400">Next of Kin:</span> <strong className="text-slate-800 dark:text-slate-200">{patient.nextOfKin}</strong></div>
                      <div><span className="text-slate-400">Emergency Phone:</span> <strong className="text-emerald-600 dark:text-emerald-400">{patient.emergencyContact}</strong></div>
                    </div>
                  </div>
                </div>

                {/* Visit Tabs in Overview */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Calendar className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                        Patient Encounter History ({visits.length} Visits)
                      </h4>
                    </div>
                  </div>

                  {/* Interactive Visit Selector Tabs */}
                  <div className="flex items-center space-x-2 overflow-x-auto pb-1">
                    {visits.map(v => {
                      const isSelected = (selectedVisit?.id === v.id);
                      return (
                        <button
                          key={v.id}
                          onClick={() => setSelectedVisitId(v.id)}
                          className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 flex-shrink-0 ${
                            isSelected
                              ? 'bg-emerald-600 text-white shadow-md'
                              : 'bg-slate-100 dark:bg-dark-surface text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-dark-border'
                          }`}
                        >
                          <Calendar className="w-3.5 h-3.5" />
                          <span>{v.visitDate}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            isSelected ? 'bg-emerald-700 text-emerald-100' : 'bg-slate-200 dark:bg-dark-card text-slate-600 dark:text-slate-300'
                          }`}>
                            {v.visitType}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Active Visit Encounter Metadata */}
                  {selectedVisit && (
                    <div className="p-3.5 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/50 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div>
                        <span className="font-bold text-slate-800 dark:text-slate-200">Encounter:</span>{' '}
                        <span className="text-emerald-700 dark:text-emerald-300 font-extrabold">{selectedVisit.visitDate} at {selectedVisit.visitTime}</span>
                        <span className="mx-2 text-slate-300 dark:text-slate-600">•</span>
                        <span className="text-slate-500">Reason:</span>{' '}
                        <span className="font-semibold text-slate-700 dark:text-slate-300">{selectedVisit.reasonForVisit || 'General Medical'}</span>
                      </div>
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                        ['Completed', 'Discharged', 'Treated'].includes(selectedVisit.status)
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300'
                      }`}>
                        {selectedVisit.status}
                      </span>
                    </div>
                  )}

                  {/* Visit Vitals Card */}
                  <div className="p-5 rounded-2xl bg-gradient-to-r from-emerald-500/5 via-teal-500/5 to-transparent border border-emerald-500/20">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-2">
                        <Activity className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        <h4 className="text-xs font-extrabold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                          Encounter Vital Signs & BMI ({selectedVisit?.visitDate || 'Current'})
                        </h4>
                      </div>
                      {visitVitals && (
                        <span className="text-[11px] text-slate-400 font-mono">
                          Recorded by {visitVitals.nurseName}
                        </span>
                      )}
                    </div>

                    {visitVitals ? (
                      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3">
                        <div className="p-3 rounded-xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border text-center">
                          <span className="text-[10px] font-bold text-slate-400 uppercase">Temp</span>
                          <div className={`text-base font-extrabold mt-0.5 ${visitVitals.temperature >= 38 ? 'text-rose-500' : 'text-slate-800 dark:text-slate-100'}`}>
                            {visitVitals.temperature}°C
                          </div>
                        </div>
                        <div className="p-3 rounded-xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border text-center">
                          <span className="text-[10px] font-bold text-slate-400 uppercase">BP</span>
                          <div className="text-base font-extrabold text-slate-800 dark:text-slate-100 mt-0.5">
                            {visitVitals.systolicBp}/{visitVitals.diastolicBp}
                          </div>
                        </div>
                        <div className="p-3 rounded-xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border text-center">
                          <span className="text-[10px] font-bold text-slate-400 uppercase">Pulse</span>
                          <div className="text-base font-extrabold text-slate-800 dark:text-slate-100 mt-0.5">
                            {visitVitals.pulse} <span className="text-[10px] font-normal text-slate-400">bpm</span>
                          </div>
                        </div>
                        <div className="p-3 rounded-xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border text-center">
                          <span className="text-[10px] font-bold text-slate-400 uppercase">Resp</span>
                          <div className="text-base font-extrabold text-slate-800 dark:text-slate-100 mt-0.5">
                            {visitVitals.respiratoryRate} <span className="text-[10px] font-normal text-slate-400">cpm</span>
                          </div>
                        </div>
                        <div className="p-3 rounded-xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border text-center">
                          <span className="text-[10px] font-bold text-slate-400 uppercase">SpO2</span>
                          <div className="text-base font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">
                            {visitVitals.spo2}%
                          </div>
                        </div>
                        <div className="p-3 rounded-xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border text-center">
                          <span className="text-[10px] font-bold text-slate-400 uppercase">Weight / Ht</span>
                          <div className="text-xs font-bold text-slate-800 dark:text-slate-100 mt-1">
                            {visitVitals.weight}kg / {visitVitals.height}m
                          </div>
                        </div>
                        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center">
                          <span className="text-[10px] font-extrabold text-emerald-700 dark:text-emerald-300 uppercase">BMI</span>
                          <div className="text-base font-black text-emerald-800 dark:text-emerald-200 mt-0.5">
                            {visitVitals.bmi}
                          </div>
                          <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 block -mt-0.5">
                            {visitVitals.bmiCategory}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400 py-3 text-center">No vital signs recorded for this encounter.</div>
                    )}
                  </div>

                  {/* Visit Consultation Brief */}
                  {visitConsultation ? (
                    <div className="p-5 rounded-2xl bg-slate-50 dark:bg-dark-surface/40 border border-light-border dark:border-dark-border">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center space-x-2">
                          <Stethoscope className="w-4 h-4 text-rose-500" />
                          <span>Physician Consultation ({visitConsultation.physicianName})</span>
                        </h4>
                        <span className="text-[11px] text-slate-400">
                          {new Date(visitConsultation.consultationDate).toLocaleDateString()}
                        </span>
                      </div>

                      <div className="text-xs text-slate-700 dark:text-slate-200 space-y-2 mt-2">
                        <div>
                          <strong className="text-slate-500">Presenting Complaint:</strong> {visitConsultation.presentingComplaint}
                        </div>
                        <div>
                          <strong className="text-slate-500">Diagnoses:</strong>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {visitConsultation.diagnoses.map(d => (
                              <span key={d.id} className="px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 font-bold text-[11px]">
                                {d.description} ({d.code}) [{d.type}]
                              </span>
                            ))}
                          </div>
                        </div>
                        {visitConsultation.plan && (
                          <div>
                            <strong className="text-slate-500">Treatment Plan:</strong> {visitConsultation.plan}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-dark-surface/40 border border-light-border dark:border-dark-border text-xs text-slate-400 text-center">
                      No physician consultation recorded for this specific encounter.
                    </div>
                  )}

                  {/* Per-visit Lab Orders & Rx Quick Glance */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-dark-surface/40 border border-light-border dark:border-dark-border">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
                          <FlaskConical className="w-3.5 h-3.5 text-amber-500" />
                          <span>Encounter Lab Orders ({visitLabs.length})</span>
                        </span>
                      </div>
                      {visitLabs.length === 0 ? (
                        <div className="text-xs text-slate-400">No laboratory tests requested during this visit.</div>
                      ) : (
                        <div className="space-y-1.5">
                          {visitLabs.flatMap(l => l.tests).map(t => (
                            <div key={t.id} className="text-xs flex items-center justify-between bg-white dark:bg-dark-card p-2 rounded-xl border border-light-border dark:border-dark-border">
                              <span className="font-semibold text-slate-800 dark:text-slate-200">{t.testName}</span>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">{t.status}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-dark-surface/40 border border-light-border dark:border-dark-border">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
                          <Pill className="w-3.5 h-3.5 text-blue-500" />
                          <span>Encounter Prescriptions ({visitRx.length})</span>
                        </span>
                      </div>
                      {visitRx.length === 0 ? (
                        <div className="text-xs text-slate-400">No medications prescribed during this visit.</div>
                      ) : (
                        <div className="space-y-1.5">
                          {visitRx.flatMap(r => r.items).map(item => (
                            <div key={item.id} className="text-xs flex items-center justify-between bg-white dark:bg-dark-card p-2 rounded-xl border border-light-border dark:border-dark-border">
                              <span className="font-semibold text-slate-800 dark:text-slate-200">{item.medicationName} ({item.dosage})</span>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300">{item.dispenseStatus}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 2. LABORATORY TAB */}
            {activeTab === 'lab' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-extrabold text-slate-800 dark:text-white flex items-center space-x-2">
                    <FlaskConical className="w-4 h-4 text-amber-500" />
                    <span>Laboratory Investigations & Released Results</span>
                  </h4>
                  <span className="text-xs text-slate-400 font-medium">
                    {labRequests.length} Order(s)
                  </span>
                </div>

                {labRequests.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-xs">No laboratory requests for this patient.</div>
                ) : (
                  labRequests.map(req => (
                    <div key={req.id} className="p-4 rounded-2xl bg-slate-50 dark:bg-dark-surface/40 border border-light-border dark:border-dark-border space-y-3">
                      <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-2">
                        <div>
                          <div className="text-xs font-bold text-slate-800 dark:text-white">Order: {req.id}</div>
                          <div className="text-[11px] text-slate-400">
                            Requested by {req.physicianName} on {new Date(req.requestedAt).toLocaleString()} • Priority: {req.priority}
                          </div>
                        </div>
                        <button
                          onClick={() => pdfService.exportLabReport(req, patient)}
                          className="flex items-center space-x-1 px-3 py-1 rounded-lg text-xs font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 transition-all"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>Print Lab Sheet</span>
                        </button>
                      </div>

                      {/* Test Items */}
                      <div className="space-y-3">
                        {req.tests.map(test => (
                          <div key={test.id} className="bg-white dark:bg-dark-card p-3 rounded-xl border border-light-border dark:border-dark-border">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                                {test.testName} <span className="text-[10px] font-semibold text-slate-400">({test.category.replace('_', ' ')})</span>
                              </span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                test.status === 'Released' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                              }`}>
                                {test.status}
                              </span>
                            </div>

                            {test.results && test.results.length > 0 ? (
                              <table className="w-full text-xs mt-2 border-collapse">
                                <thead>
                                  <tr className="border-b border-light-border dark:border-dark-border text-[10px] text-slate-400 text-left">
                                    <th className="py-1">Parameter</th>
                                    <th className="py-1">Result</th>
                                    <th className="py-1">Unit</th>
                                    <th className="py-1">Ref Range</th>
                                    <th className="py-1">Flag</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {test.results.map((r, idx) => (
                                    <tr key={idx} className="border-b border-light-border/40 dark:border-dark-border/40 text-xs">
                                      <td className="py-1.5 font-semibold text-slate-700 dark:text-slate-300">{r.parameterName}</td>
                                      <td className="py-1.5 font-bold text-slate-900 dark:text-white">{r.value}</td>
                                      <td className="py-1.5 text-slate-500">{r.unit || '-'}</td>
                                      <td className="py-1.5 text-slate-500">{r.referenceRange}</td>
                                      <td className="py-1.5">
                                        <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                                          r.flag === 'High' || r.flag === 'Critical' ? 'bg-rose-100 text-rose-700' : r.flag === 'Low' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                                        }`}>
                                          {r.flag}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <div className="text-[11px] text-slate-400 italic">Sample collection / processing in laboratory.</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* 3. PHARMACY TAB */}
            {activeTab === 'pharmacy' && (
              <div className="space-y-4">
                <h4 className="text-sm font-extrabold text-slate-800 dark:text-white flex items-center space-x-2">
                  <Pill className="w-4 h-4 text-purple-500" />
                  <span>Prescriptions & Medication Dispensing</span>
                </h4>

                {prescriptions.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-xs">No prescriptions on file.</div>
                ) : (
                  prescriptions.map(rx => (
                    <div key={rx.id} className="p-4 rounded-2xl bg-slate-50 dark:bg-dark-surface/40 border border-light-border dark:border-dark-border space-y-3">
                      <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-2">
                        <div>
                          <div className="text-xs font-bold text-slate-800 dark:text-white">Prescription: {rx.id}</div>
                          <div className="text-[11px] text-slate-400">
                            Prescribed by {rx.physicianName} on {new Date(rx.prescribedAt).toLocaleString()}
                          </div>
                        </div>
                        <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                          rx.status === 'Completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                        }`}>
                          {rx.status}
                        </span>
                      </div>

                      <div className="space-y-2">
                        {rx.items.map(item => (
                          <div key={item.id} className="p-2.5 rounded-xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border flex items-center justify-between text-xs">
                            <div>
                              <div className="font-bold text-slate-800 dark:text-slate-100">{item.medicationName}</div>
                              <div className="text-[11px] text-slate-500">
                                {item.dosage} • {item.frequency} • Duration: {item.duration} • Route: {item.route}
                              </div>
                              <div className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5">
                                Inst: {item.instructions}
                              </div>
                            </div>
                            <div className="text-right">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                item.dispenseStatus === 'Dispensed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                              }`}>
                                {item.dispenseStatus} ({item.quantityDispensed}/{item.quantityPrescribed})
                              </span>
                              <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mt-1">
                                {settings.currency}{item.totalPrice.toLocaleString()}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* 4. NURSING TAB */}
            {activeTab === 'nursing' && (
              <div className="space-y-4">
                <h4 className="text-sm font-extrabold text-slate-800 dark:text-white flex items-center space-x-2">
                  <Stethoscope className="w-4 h-4 text-teal-500" />
                  <span>Nursing Notes, Assessments & Care Plans</span>
                </h4>

                {vitalsList.map(v => (
                  <div key={v.id} className="p-4 rounded-2xl bg-slate-50 dark:bg-dark-surface/40 border border-light-border dark:border-dark-border space-y-2 text-xs">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>Recorded by <strong>{v.nurseName}</strong></span>
                      <span>{new Date(v.recordedAt).toLocaleString()}</span>
                    </div>

                    {v.nursingNotes && (
                      <div className="p-3 rounded-xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border">
                        <strong className="text-slate-500 block mb-1">Nursing Assessment:</strong>
                        <p className="text-slate-700 dark:text-slate-200 leading-relaxed">{v.nursingNotes}</p>
                      </div>
                    )}

                    {v.nursingCarePlan && (
                      <div className="p-3 rounded-xl bg-teal-50/50 dark:bg-teal-950/20 border border-teal-200/50 dark:border-teal-900/50">
                        <strong className="text-teal-700 dark:text-teal-300 block mb-1">Nursing Care Plan:</strong>
                        <p className="text-teal-900 dark:text-teal-200 leading-relaxed">{v.nursingCarePlan}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* 5. BILLING TAB */}
            {activeTab === 'billing' && (
              <div className="space-y-4">
                <h4 className="text-sm font-extrabold text-slate-800 dark:text-white flex items-center space-x-2">
                  <Receipt className="w-4 h-4 text-blue-500" />
                  <span>Patient Invoices, Charges & Receipts</span>
                </h4>

                {invoices.map(inv => (
                  <div key={inv.id} className="p-4 rounded-2xl bg-slate-50 dark:bg-dark-surface/40 border border-light-border dark:border-dark-border space-y-3">
                    <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-2">
                      <div>
                        <div className="text-xs font-bold text-slate-800 dark:text-white">{inv.id}</div>
                        <div className="text-[11px] text-slate-400">Date: {inv.date}</div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full ${
                          inv.paymentStatus === 'Paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                        }`}>
                          {inv.paymentStatus}
                        </span>
                        <button
                          onClick={() => pdfService.exportInvoice(inv, patient)}
                          className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-white dark:bg-dark-card border border-light-border dark:border-dark-border hover:bg-slate-100"
                        >
                          <Printer className="w-3 h-3 text-slate-600" />
                          <span>Receipt</span>
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      {inv.items.map(item => (
                        <div key={item.id} className="flex justify-between text-xs py-1 border-b border-light-border/40 dark:border-dark-border/40">
                          <span className="text-slate-700 dark:text-slate-300">{item.description}</span>
                          <span className="font-bold text-slate-800 dark:text-slate-100">{settings.currency}{item.totalPrice.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>

                    <div className="flex justify-between items-center pt-2 font-bold text-xs">
                      <span>Total: {settings.currency}{inv.total.toLocaleString()}</span>
                      <span className="text-emerald-600">Paid: {settings.currency}{inv.paidAmount.toLocaleString()}</span>
                      <span className={inv.balance > 0 ? 'text-rose-500' : 'text-slate-400'}>Balance: {settings.currency}{inv.balance.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 6. DOCUMENTS TAB */}
            {activeTab === 'documents' && (
              <div className="p-8 text-center text-slate-400 text-xs">
                <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p>Radiology Scans & Clinical Documents Archive</p>
                <p className="text-[11px] mt-1 text-slate-400">All reports and scanned test documents are digitally indexed.</p>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
};
