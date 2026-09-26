import React, { useState, useEffect } from 'react';
import { Patient, Visit, Vitals, wardName } from '../../types';
import { db } from '../../services/db';
import { useCurrentUser } from '../../context/AuthContext';
import { useSyncDb } from '../../hooks/useSyncDb';
import {
  CheckCircle2,
  Thermometer,
  Scale,
  Save,
  FlaskConical,
  Pill,
  Plus,
  Send,
  Layers,
  Calendar,
  User,
  X,
  HeartPulse,
  ClipboardList,
  Syringe,
  LogOut,
  Search,
  ListChecks,
  Lock,
  BedDouble
} from 'lucide-react';
import { AdmitDialog } from './AdmitDialog';

interface NursingStationProps {
  selectedVisit?: Visit;
  selectedPatient?: Patient;
  onSelectPatient?: (patient: Patient) => void;
  onSelectVisit?: (visit: Visit) => void;
  onOpenProfile?: (patient: Patient) => void;
  onVitalsSaved?: (vitals: Vitals) => void;
  activeSubNav?: string;
}

type NursingTab = 'vitals' | 'assessment' | 'orders';

export const NursingStation: React.FC<NursingStationProps> = ({
  selectedVisit,
  selectedPatient,
  onSelectPatient,
  onSelectVisit,
  onOpenProfile,
  onVitalsSaved,
  activeSubNav,
}) => {
  const currentUser = useCurrentUser();
  const syncTick = useSyncDb();

  const allPatients = db.getPatients();
  const [currentPatientId, setCurrentPatientId] = useState<string>(selectedPatient?.id || selectedVisit?.patientId || '');
  const patient = allPatients.find(p => p.id === currentPatientId) || selectedPatient || (selectedVisit ? db.getPatientById(selectedVisit.patientId) : undefined) || null;

  const patientVisits = patient ? db.getVisits(patient.id) : [];
  const [activeVisitId, setActiveVisitId] = useState<string>(selectedVisit?.id || patientVisits[0]?.id || '');

  const activeVisit = patientVisits.find(v => v.id === activeVisitId) || selectedVisit || patientVisits[0] || undefined;
  const activePatient = patient;
  const existingVitals = activeVisit && activePatient ? db.getVitals(activeVisit.id, activePatient.id)[0] : undefined;

  const [nursingTab, setNursingTab] = useState<NursingTab>('vitals');
  const [showPatientSearch, setShowPatientSearch] = useState(false);
  const [patientSearch, setPatientSearch] = useState('');
  const [showAddVisit, setShowAddVisit] = useState(false);
  const [showAdmit, setShowAdmit] = useState(false);
  const [newVisitType, setNewVisitType] = useState<Visit['visitType']>('New Visit');
  const [newVisitReason, setNewVisitReason] = useState('');
  const [progressPatientId, setProgressPatientId] = useState<string | null>(null);

  // Care-progress checklist for the list view (latest visit per patient).
  // Done items render light-green; pending items render neutral.
  const getNursingChecklist = (p: Patient): Array<{ label: string; done: boolean; detail: string }> => {
    const latestVisit = db.getVisits(p.id)[0];
    if (!latestVisit) {
      return [
        { label: "Patient's Info", done: true, detail: `${p.sex}, ${p.age}y • ${p.id}` },
        { label: 'Vitals', done: false, detail: 'No visit yet' },
        { label: 'Assessment & Care Plan', done: false, detail: 'Not started' },
        { label: "Doctor's Lab Requests", done: false, detail: 'Not started' },
        { label: "Doctor's Prescriptions", done: false, detail: 'Not started' },
        { label: "Doctor's Radiology", done: false, detail: 'Not started' },
        { label: "Doctor's Physiotherapy", done: false, detail: 'Not started' },
        { label: 'Sent to Doctor', done: false, detail: 'Not sent' },
        { label: 'Visit Completed', done: false, detail: 'Ongoing' },
      ];
    }
    const vitalsRec = db.getVitals(latestVisit.id, p.id)[0];
    const careDone = !!vitalsRec && (!!vitalsRec.nursingNotes || !!vitalsRec.nursingCarePlan || (vitalsRec.nursingProcedures?.length || 0) > 0);
    const labs = db.getLabRequests({ visitId: latestVisit.id });
    const labsWithResult = labs.filter(r => r.tests.some(t => ['Released', 'Verified'].includes(t.status))).length;
    const rxs = db.getPrescriptions(p.id, latestVisit.id);
    const rad = db.getRadiologyOrders(p.id, latestVisit.id);
    const physio = db.getPhysiotherapyOrders(p.id, latestVisit.id);
    const sentToDoctor = ['With Doctor', 'Awaiting Physician', 'In Consultation', 'Awaiting Lab', 'Awaiting Pharmacy', 'Awaiting Payment', 'Admitted', 'Completed', 'Discharged'].includes(latestVisit.status);
    return [
      { label: "Patient's Info", done: true, detail: `${p.sex}, ${p.age}y • Visit ${latestVisit.visitDate} (${latestVisit.status})` },
      { label: 'Vitals', done: !!vitalsRec, detail: vitalsRec ? `BP ${vitalsRec.systolicBp}/${vitalsRec.diastolicBp} • SpO2 ${vitalsRec.spo2}%` : 'Not recorded' },
      { label: 'Assessment & Care Plan', done: careDone, detail: careDone ? 'Documented' : 'Not documented' },
      { label: "Doctor's Lab Requests", done: labs.length > 0, detail: labs.length ? `${labs.length} order(s)${labsWithResult ? ` • ${labsWithResult} result(s) ready` : ''}` : 'None yet' },
      { label: "Doctor's Prescriptions", done: rxs.length > 0, detail: rxs.length ? `${rxs.length} prescription(s)` : 'None yet' },
      { label: "Doctor's Radiology", done: rad.length > 0, detail: rad.length ? `${rad.length} order(s)` : 'None yet' },
      { label: "Doctor's Physiotherapy", done: physio.length > 0, detail: physio.length ? `${physio.length} order(s)` : 'None yet' },
      { label: 'Sent to Doctor', done: sentToDoctor, detail: sentToDoctor ? 'Sent ✓' : 'Still with nurse' },
      { label: 'Visit Completed', done: ['Completed', 'Discharged', 'Treated'].includes(latestVisit.status), detail: ['Completed', 'Discharged', 'Treated'].includes(latestVisit.status) ? `${latestVisit.status} ✓` : latestVisit.status },
    ];
  };

  const readOnlyLabs = activeVisit ? db.getLabRequests({ visitId: activeVisit.id }) : [];
  const readOnlyRxs = activeVisit && activePatient ? db.getPrescriptions(activePatient.id, activeVisit.id) : [];
  const readOnlyRad = activeVisit && activePatient ? db.getRadiologyOrders(activePatient.id, activeVisit.id) : [];
  const readOnlyPhysio = activeVisit && activePatient ? db.getPhysiotherapyOrders(activePatient.id, activeVisit.id) : [];

  const patientSearchResults = React.useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const base = patientSearch.trim() ? db.searchPatients(patientSearch) : allPatients;
    const idsFor = (pred: (v: Visit) => boolean) => new Set(db.getVisits().filter(v => v.visitDate === today && pred(v)).map(v => v.patientId));

    if (activeSubNav === 'nursing_awaiting') {
      // Not yet sent to doctor and not treated
      const ids = idsFor(v => ['Awaiting Vitals', 'With Nurse'].includes(v.status));
      return base.filter(p => ids.has(p.id));
    } else if (activeSubNav === 'nursing_consulting') {
      // Nurse has started attending (vitals taken) but not sent to doctor or treated
      const ids = idsFor(v => v.status === 'With Nurse' && db.getVitals(v.id, v.patientId).length > 0);
      return base.filter(p => ids.has(p.id));
    } else if (activeSubNav === 'nursing_with_doctor') {
      // Sent to doctor; doctor hasn't admitted/treated/scheduled yet
      const ids = idsFor(v => ['With Doctor', 'Awaiting Physician'].includes(v.status));
      return base.filter(p => ids.has(p.id));
    } else if (activeSubNav === 'nursing_incoming') {
      // Still undergoing registration at Front Desk — profile only
      const ids = idsFor(v => v.status === 'Awaiting Vitals');
      return base.filter(p => ids.has(p.id));
    }
    return base;
  }, [patientSearch, activeSubNav, syncTick]);

  const filterLabel = activeSubNav === 'nursing_awaiting' ? 'Awaiting' : activeSubNav === 'nursing_consulting' ? 'Consulting' : activeSubNav === 'nursing_with_doctor' ? 'With Doctor' : activeSubNav === 'nursing_incoming' ? 'Incoming' : 'All Patients';

  const displayPatients = patientSearchResults;

  // Switching queue submenu (All / Awaiting / Consulting / With Doctor / Incoming) always
  // shows the filtered patient list first — clear any open patient details.
  React.useEffect(() => {
    setCurrentPatientId('');
    setActiveVisitId('');
    setPatientSearch('');
    setProgressPatientId(null);
  }, [activeSubNav]);

  const handlePickPatient = (p: Patient) => {    setCurrentPatientId(p.id);
    const vs = db.getVisits(p.id);
    setActiveVisitId(vs[0]?.id || '');
    if (onSelectPatient) onSelectPatient(p);
    if (vs[0] && onSelectVisit) onSelectVisit(vs[0]);
    setShowPatientSearch(false);
  };

  const handleCreateVisit = () => {
    if (!patient) return;
    const visit = db.createVisit({
      patientId: patient.id,
      visitDate: new Date().toISOString().split('T')[0],
      visitTime: new Date().toTimeString().slice(0, 5),
      visitType: newVisitType,
      status: 'With Nurse',
      reasonForVisit: newVisitReason || 'Nursing triage assessment'
    }, currentUser);
    setActiveVisitId(visit.id);
    if (onSelectVisit) onSelectVisit(visit);
    setShowAddVisit(false);
    setNewVisitReason('');
  };

  // Detail dialog for viewing doctor's requests
  const [detailDialogType, setDetailDialogType] = useState<'lab' | 'rx' | 'rad' | 'physio' | null>(null);
  const [detailDialogData, setDetailDialogData] = useState<any>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);

  const openDetailDialog = (type: 'lab' | 'rx' | 'rad' | 'physio', data: any) => {
    setDetailDialogType(type);
    setDetailDialogData(data);
    setShowDetailDialog(true);
  };

  // Form State — blank for new patients (no defaults); filled from saved vitals when present
  const [temperature, setTemperature] = useState<number | ''>(existingVitals?.temperature ?? '');
  const [systolicBp, setSystolicBp] = useState<number | ''>(existingVitals?.systolicBp ?? '');
  const [diastolicBp, setDiastolicBp] = useState<number | ''>(existingVitals?.diastolicBp ?? '');
  const [pulse, setPulse] = useState<number | ''>(existingVitals?.pulse ?? '');
  const [respiratoryRate, setRespiratoryRate] = useState<number | ''>(existingVitals?.respiratoryRate ?? '');
  const [spo2, setSpo2] = useState<number | ''>(existingVitals?.spo2 ?? '');
  const [weight, setWeight] = useState<number | ''>(existingVitals?.weight ?? '');
  const [height, setHeight] = useState<number | ''>(existingVitals?.height ?? '');
  const [painScore, setPainScore] = useState<number>(existingVitals?.painScore || 0);
  const [nursingNotes, setNursingNotes] = useState<string>(existingVitals?.nursingNotes || '');
  const [nursingCarePlan, setNursingCarePlan] = useState<string>(existingVitals?.nursingCarePlan || '');
  const [procedures, setProcedures] = useState<string[]>(existingVitals?.nursingProcedures || []);

  const [savedSuccess, setSavedSuccess] = useState(false);

  // Sync when selected visit changes
  useEffect(() => {
    if (selectedVisit) {
      setActiveVisitId(selectedVisit.id);
    }
  }, [selectedVisit]);

  // Sync form when activeVisitId changes
  useEffect(() => {
    if (activeVisit) {
      const v = db.getVitals(activeVisit.id, activeVisit.patientId)[0];
      setTemperature(v?.temperature ?? '');
      setSystolicBp(v?.systolicBp ?? '');
      setDiastolicBp(v?.diastolicBp ?? '');
      setPulse(v?.pulse ?? '');
      setRespiratoryRate(v?.respiratoryRate ?? '');
      setSpo2(v?.spo2 ?? '');
      setWeight(v?.weight ?? '');
      setHeight(v?.height ?? '');
      setPainScore(v?.painScore || 0);
      setNursingNotes(v?.nursingNotes || '');
      setNursingCarePlan(v?.nursingCarePlan || '');
      setProcedures(v?.nursingProcedures || []);
    }
  }, [activeVisitId]);

  // Real-time BMI calculation (only when weight & height are entered)
  const effectiveHeight = height === '' ? 0 : height > 3 ? height / 100 : height;
  const calculatedBmi = weight !== '' && effectiveHeight > 0 ? Number((weight / (effectiveHeight * effectiveHeight)).toFixed(1)) : null;

  const getBmiBadge = (bmi: number) => {
    if (bmi < 18.5) return { label: 'Underweight', color: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300' };
    if (bmi < 25) return { label: 'Normal Weight', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' };
    if (bmi < 30) return { label: 'Overweight', color: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' };
    if (bmi < 35) return { label: 'Obese Class I', color: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300' };
    if (bmi < 40) return { label: 'Obese Class II', color: 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300' };
    return { label: 'Obese Class III (Morbid)', color: 'bg-red-200 text-red-900 dark:bg-red-950/80 dark:text-red-200' };
  };

  const bmiInfo = calculatedBmi !== null ? getBmiBadge(calculatedBmi) : null;

  const availableProcedures = [
    'Vital signs monitoring & triage',
    'Tepid sponging for fever',
    'Intravenous cannulation',
    'Aseptic wound dressing',
    'Intramuscular injection administration',
    'Oral hydration enforcement',
    'Oxygen therapy setup'
  ];

  const toggleProcedure = (proc: string) => {
    if (procedures.includes(proc)) {
      setProcedures(procedures.filter(p => p !== proc));
    } else {
      setProcedures([...procedures, proc]);
    }
  };

  const handleSaveVitals = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeVisit || !activePatient) return;

    const missing: string[] = [];
    if (temperature === '') missing.push('Temperature');
    if (systolicBp === '') missing.push('Systolic BP');
    if (diastolicBp === '') missing.push('Diastolic BP');
    if (pulse === '') missing.push('Pulse');
    if (respiratoryRate === '') missing.push('Respiratory Rate');
    if (spo2 === '') missing.push('SpO2');
    if (weight === '') missing.push('Weight');
    if (height === '') missing.push('Height');
    if (missing.length > 0) { alert(`Record vitals: please fill in ${missing.join(', ')}.`); return; }

    const tempNum = Number(temperature);
    const hgtNum = Number(height);
    const recorded = db.recordVitals({
      visitId: activeVisit.id,
      patientId: activePatient.id,
      nurseId: currentUser.id,
      nurseName: currentUser.name,
      temperature: tempNum,
      systolicBp: Number(systolicBp),
      diastolicBp: Number(diastolicBp),
      pulse: Number(pulse),
      respiratoryRate: Number(respiratoryRate),
      spo2: Number(spo2),
      weight: Number(weight),
      height: hgtNum > 3 ? hgtNum / 100 : hgtNum,
      painScore,
      nursingNotes,
      nursingCarePlan,
      nursingProcedures: procedures,
      alerts: tempNum >= 38 ? ['High Grade Fever Spike'] : []
    }, currentUser);

    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
    if (onVitalsSaved) onVitalsSaved(recorded);
  };

  return (
    <div className="h-full flex flex-col select-text overflow-hidden p-4 md:p-6 space-y-4">
      {/* Compact action bar */}
      <div className="flex items-center justify-between gap-2 p-2.5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex-shrink-0">
        <span className="text-[11px] font-extrabold uppercase tracking-wider text-teal-600 dark:text-teal-400 ml-1">
          Nursing • Vitals & Triage
        </span>
        <div className="flex items-center space-x-2">
          {savedSuccess && (
            <span className="flex items-center space-x-1 text-[11px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-lg animate-in fade-in">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Recorded!</span>
            </span>
          )}
          <button
            onClick={handleSaveVitals}
            className="flex items-center space-x-1 px-4 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Vital Signs & Triage</span>
          </button>
        </div>
      </div>

      {/* Patient + Visit selector row (workflow: Add Patient button + visit selector + Add Visit) */}
      {!activePatient ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="p-3 bg-white dark:bg-dark-card border-b border-light-border dark:border-dark-border flex items-center gap-2 flex-shrink-0">
            <span className="text-[10px] font-bold text-teal-600 px-2.5 py-1.5 rounded-lg bg-teal-50 border border-teal-200 flex-shrink-0">{filterLabel} — {displayPatients.length}</span>
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={patientSearch} onChange={e => setPatientSearch(e.target.value)} placeholder="Search patients..." className="w-full pl-8 pr-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border focus:ring-2 focus:ring-teal-500 focus:outline-none" />
            </div>
            <button type="button" onClick={() => { setPatientSearch(''); setShowPatientSearch(true); }} className="px-3 py-2 rounded-xl text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white flex items-center space-x-1 flex-shrink-0"><Plus className="w-3.5 h-3.5" /><span>Add Patient</span></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {displayPatients.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400">
                <User className="w-12 h-12 mb-3 opacity-30" />
                <p className="font-bold text-sm">No patients found</p>
                <p className="text-xs mt-1">{filterLabel === 'All Patients' ? 'No patients registered yet.' : `No patients matching "${filterLabel}" filter.`}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {displayPatients.map(p => {
                  const pVisits = db.getVisits(p.id);
                  const latestVisit = pVisits[0];
                  const hasScheduled = pVisits.some(v => ['Awaiting Vitals', 'With Nurse'].includes(v.status));
                  const profileOnly = activeSubNav === 'nursing_incoming';
                  const dotCls = !latestVisit ? 'bg-slate-300'
                    : ['Treated', 'Completed', 'Discharged'].includes(latestVisit.status) ? 'bg-emerald-500'
                    : latestVisit.status === 'In Consultation' ? 'bg-blue-500 animate-pulse'
                    : ['With Doctor', 'Awaiting Physician'].includes(latestVisit.status) ? 'bg-violet-500 animate-pulse'
                    : latestVisit.status === 'With Nurse' ? 'bg-teal-500 animate-pulse'
                    : 'bg-amber-500';
                  return (
                    <div key={p.id} onClick={() => { if (profileOnly) { if (onOpenProfile) onOpenProfile(p); return; } setCurrentPatientId(p.id); setActiveVisitId(pVisits[0]?.id || ''); if (onSelectPatient) onSelectPatient(p); }} className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border hover:border-teal-400 hover:shadow-md cursor-pointer transition-all group">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 rounded-full bg-teal-100 dark:bg-teal-950/40 flex items-center justify-center text-lg font-bold text-teal-600">{p.firstName[0]}{p.lastName[0]}</div>
                          <div>
                            <div className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-teal-600 transition-colors">{p.firstName} {p.lastName}</div>
                            <div className="text-[11px] text-slate-500 font-mono">{p.id}</div>
                          </div>
                        </div>
                        <div className="flex items-center space-x-1.5 flex-shrink-0">
                          {hasScheduled && <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-700 border border-amber-200">Active</span>}
                          {profileOnly && <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-slate-100 text-slate-500 border border-slate-200 flex items-center space-x-1"><Lock className="w-2.5 h-2.5" /><span>Profile only</span></span>}
                          <button
                            type="button"
                            title="Care progress — what is done / pending"
                            onClick={(e) => { e.stopPropagation(); setProgressPatientId(p.id); }}
                            className="p-1.5 rounded-lg bg-slate-100 dark:bg-dark-surface hover:bg-teal-100 dark:hover:bg-teal-950/40 text-slate-500 hover:text-teal-600 border border-light-border dark:border-dark-border transition-colors"
                          >
                            <ListChecks className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 pt-2 border-t border-slate-100 dark:border-dark-border flex items-center justify-between text-[11px] text-slate-500">
                        <span>{p.sex}, {p.age}y • {p.phone}</span>
                        <span className="font-bold">{pVisits.length} visit(s)</span>
                      </div>
                      {latestVisit && (
                        <div className="mt-2 flex items-center space-x-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${dotCls}`} />
                          <span className="text-[10px] font-bold text-slate-500">{latestVisit.status}</span>
                          <span className="text-[10px] text-slate-400">• {latestVisit.visitDate}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {/* Care-progress dialog: all tasks, done ones light-green */}
          {progressPatientId && (() => {
            const pp = allPatients.find(x => x.id === progressPatientId);
            if (!pp) return null;
            const items = getNursingChecklist(pp);
            const doneCount = items.filter(i => i.done).length;
            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-slate-900/60" onClick={() => setProgressPatientId(null)} />
                <div className="relative bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-md border border-light-border dark:border-dark-border">
                  <div className="px-5 py-4 border-b border-light-border dark:border-dark-border flex items-center justify-between">
                    <div>
                      <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center space-x-2">
                        <ListChecks className="w-4 h-4 text-teal-500" />
                        <span>Care Progress — {pp.firstName} {pp.lastName}</span>
                      </h3>
                      <p className="text-[11px] text-slate-500 mt-0.5 font-mono">{pp.id} • {doneCount}/{items.length} complete</p>
                    </div>
                    <button onClick={() => setProgressPatientId(null)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-surface"><X className="w-4 h-4" /></button>
                  </div>
                  <div className="p-4 space-y-1.5 max-h-[50vh] overflow-y-auto">
                    {items.map(it => (
                      <div key={it.label} className={`flex items-center justify-between px-3 py-2 rounded-xl border text-xs ${it.done ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200' : 'bg-slate-50 dark:bg-dark-surface border-slate-200 dark:border-dark-border text-slate-500 dark:text-slate-400'}`}>
                        <span className="flex items-center space-x-2 font-bold">
                          {it.done
                            ? <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                            : <span className="w-4 h-4 rounded-full border-2 border-slate-300 dark:border-slate-600 flex-shrink-0" />}
                          <span>{it.label}</span>
                        </span>
                        <span className={`text-[10px] font-bold ${it.done ? '' : 'text-slate-400'}`}>{it.done ? `✓ ${it.detail}` : it.detail}</span>
                      </div>
                    ))}
                  </div>
                  <div className="px-5 py-3 bg-slate-50 dark:bg-dark-surface/60 rounded-b-2xl flex justify-end space-x-2">
                    <button onClick={() => setProgressPatientId(null)} className="px-4 py-2 rounded-xl text-xs font-bold border border-light-border dark:border-dark-border">Close</button>
                    <button
                      onClick={() => { handlePickPatient(pp); setProgressPatientId(null); }}
                      className="px-5 py-2 rounded-xl text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white"
                    >
                      Open Patient Details
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      ) : (
      <div className="flex-1 min-h-0 overflow-hidden flex gap-4">
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 min-w-0">
        <div className="p-3 rounded-2xl bg-white dark:bg-dark-card border flex flex-wrap items-center gap-2 flex-shrink-0">
          <div className="flex items-center space-x-2 font-bold text-xs">
            <User className="w-3.5 h-3.5 text-teal-600" />
            <span>{activePatient.firstName} {activePatient.lastName} <span className="font-mono text-[10px] text-teal-600">({activePatient.id})</span></span>
          </div>
          <span className="text-slate-300">•</span>
          <div className="flex items-center space-x-1 text-xs">
            <Calendar className="w-3.5 h-3.5 text-blue-500" />
            <select value={activeVisitId} onChange={e => { setActiveVisitId(e.target.value); const v = patientVisits.find(x => x.id === e.target.value); if (v && onSelectVisit) onSelectVisit(v); }} className="bg-transparent font-semibold focus:outline-none cursor-pointer max-w-[280px]">
              {patientVisits.length === 0 ? <option value="">No visits yet — add one</option> : patientVisits.map(v => <option key={v.id} value={v.id}>Visit: {v.visitDate} ({v.visitType}) - {v.status}</option>)}
            </select>
          </div>
          <button type="button" onClick={() => { setPatientSearch(''); setShowPatientSearch(true); }} className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-teal-50 text-teal-700 border border-teal-200 flex items-center space-x-1"><Plus className="w-3 h-3" /><span>Add Patient</span></button>
          <button type="button" onClick={() => setShowAddVisit(true)} className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200 flex items-center space-x-1"><Calendar className="w-3 h-3" /><span>Add Visit</span></button>
          {activeVisit && ['Awaiting Vitals', 'With Nurse'].includes(activeVisit.status) && (
            <button type="button" onClick={() => { db.updateVisitStatus(activeVisit.id, 'With Doctor', currentUser); }} className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-purple-600 hover:bg-purple-700 text-white flex items-center space-x-1"><Send className="w-3 h-3" /><span>Send to Doctor</span></button>
          )}
          {activeVisit && ['Awaiting Vitals', 'With Nurse'].includes(activeVisit.status) && (
            <button type="button" onClick={() => { if (confirm('Mark this patient as Treated? They will not be sent to the doctor.')) db.updateVisitStatus(activeVisit.id, 'Treated', currentUser); }} className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center space-x-1"><CheckCircle2 className="w-3 h-3" /><span>Treated</span></button>
          )}
          {activeVisit && !['Admitted', 'Discharged', 'Completed', 'Treated'].includes(activeVisit.status) && (
            <button type="button" onClick={() => setShowAdmit(true)} className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-600 hover:bg-amber-700 text-white flex items-center space-x-1"><BedDouble className="w-3 h-3" /><span>Admit</span></button>
          )}
          {activeVisit && activeVisit.status === 'Admitted' && (
            <button type="button" onClick={() => { if (confirm('Discharge this admitted patient?')) db.updateVisitStatus(activeVisit.id, 'Discharged', currentUser); }} className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-rose-600 hover:bg-rose-700 text-white flex items-center space-x-1"><LogOut className="w-3 h-3" /><span>Discharge</span></button>
          )}
          {activeVisit && activeVisit.status === 'Admitted' && activeVisit.ward && (
            <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-indigo-100 text-indigo-700 border border-indigo-200">Ward: {wardName(activeVisit.ward)}</span>
          )}
        </div>

        {/* Nursing tabs: Vitals | Assessment | Orders (Lab, Pharmacy, Radiology, Physio, Procedures) */}
        <div className="flex items-center space-x-1 overflow-x-auto flex-shrink-0 bg-white dark:bg-dark-card border rounded-xl p-1">
          {[
            { id: 'vitals', label: 'Vitals', icon: <Thermometer className="w-3.5 h-3.5" /> },
            { id: 'assessment', label: 'Assessment & Care Plan', icon: <ClipboardList className="w-3.5 h-3.5" /> },
            { id: 'orders', label: 'Results (Lab • Pharmacy • Radiology • Physio)', icon: <Syringe className="w-3.5 h-3.5" /> },
          ].map(t => (
            <button key={t.id} type="button" onClick={() => setNursingTab(t.id as NursingTab)} className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold flex-shrink-0 ${nursingTab === t.id ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{t.icon}<span>{t.label}</span></button>
          ))}
        </div>

        <div className="space-y-5">
          {activePatient && activeVisit ? (
            <form onSubmit={handleSaveVitals} className="space-y-5">

              {/* Selected Patient Banner */}
              <div className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex items-center justify-between">
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                      {activePatient.firstName} {activePatient.lastName}
                    </h3>
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-dark-surface font-bold">
                      {activePatient.id}
                    </span>
                    <span className="text-xs text-slate-500">
                      {activePatient.sex} • {activePatient.age}y
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Encounter: {activeVisit.visitDate} • Reason: {activeVisit.reasonForVisit || 'General Clinical'}
                  </p>
                </div>

                {activePatient.allergies.length > 0 && (
                  <span className="text-[10px] font-bold px-2 py-1 rounded bg-rose-50 dark:bg-rose-950/40 text-rose-600 border border-rose-200">
                    Allergies: {activePatient.allergies.join(', ')}
                  </span>
                )}
              </div>

              {/* Vitals tab */}
              {nursingTab === 'vitals' && (
              <div className="p-5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-4">
                <div className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 border-b border-light-border dark:border-dark-border pb-2 flex items-center space-x-2">
                  <Thermometer className="w-4 h-4 text-rose-500" />
                  <span>Vital Signs Measurement</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Temperature (°C):</label>
                    <input
                      type="number"
                      step="0.1"
                      required
                      value={temperature}
                      onChange={e => setTemperature(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 font-bold focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Systolic BP (mmHg):</label>
                    <input
                      type="number"
                      required
                      value={systolicBp}
                      onChange={e => setSystolicBp(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 font-bold focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Diastolic BP (mmHg):</label>
                    <input
                      type="number"
                      required
                      value={diastolicBp}
                      onChange={e => setDiastolicBp(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 font-bold focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Pulse (bpm):</label>
                    <input
                      type="number"
                      required
                      value={pulse}
                      onChange={e => setPulse(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 font-bold focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Respiratory Rate (cpm):</label>
                    <input
                      type="number"
                      required
                      value={respiratoryRate}
                      onChange={e => setRespiratoryRate(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 font-bold focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">SpO2 Oxygen (%):</label>
                    <input
                      type="number"
                      required
                      value={spo2}
                      onChange={e => setSpo2(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 font-bold focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Weight (kg):</label>
                    <input
                      type="number"
                      step="0.5"
                      required
                      value={weight}
                      onChange={e => setWeight(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 font-bold focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Height (meters):</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={height}
                      onChange={e => setHeight(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 font-bold focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                {/* Real-Time Auto-Calculated BMI Banner */}
                <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-transparent border border-emerald-500/30 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Scale className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                    <div>
                      <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                        Body Mass Index (Auto Calculated)
                      </div>
                      <div className="text-xl font-black text-slate-900 dark:text-white">
                        {calculatedBmi !== null ? calculatedBmi : '—'} <span className="text-xs font-normal text-slate-400">kg/m²</span>
                      </div>
                    </div>
                  </div>

                  {bmiInfo ? (
                    <span className={`text-xs font-extrabold px-3 py-1.5 rounded-xl shadow-sm ${bmiInfo.color}`}>
                      {bmiInfo.label}
                    </span>
                  ) : (
                    <span className="text-xs font-bold px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-dark-surface text-slate-400">
                      Enter weight & height
                    </span>
                  )}
                </div>
              </div>
              )}

              {/* Assessment tab */}
              {nursingTab === 'assessment' && (
              <div className="p-5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-4 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Nursing Assessment Notes:
                  </label>
                  <textarea
                    rows={2}
                    value={nursingNotes}
                    onChange={e => setNursingNotes(e.target.value)}
                    placeholder="Patient appearance, orientation, distress level, shivering, hydration status..."
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Nursing Care Plan:
                  </label>
                  <textarea
                    rows={2}
                    value={nursingCarePlan}
                    onChange={e => setNursingCarePlan(e.target.value)}
                    placeholder="Specific nursing interventions e.g. Tepid sponge q2h, oral fluids >2L, vital checks..."
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    Nursing Procedures Performed:
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {availableProcedures.map(proc => {
                      const isChecked = procedures.includes(proc);

                      return (
                        <label
                          key={proc}
                          className={`px-3 py-2 rounded-xl border flex items-center space-x-2 cursor-pointer transition-all ${
                            isChecked
                              ? 'bg-teal-50 dark:bg-teal-950/40 border-teal-300 dark:border-teal-800 font-bold text-teal-800 dark:text-teal-200'
                              : 'bg-slate-50 dark:bg-dark-surface/40 border-light-border dark:border-dark-border text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleProcedure(proc)}
                            className="rounded text-teal-600 focus:ring-teal-500"
                          />
                          <span className="text-[11px]">{proc}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
              )}

              {/* Results tab — doctor orders + results only (nursing cannot create requests) */}
              {nursingTab === 'orders' && (
              <div className="p-5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-3">
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center space-x-2">
                      <Layers className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span>Doctor Orders & Results (Read-Only for Nursing)</span>
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Nursing cannot create orders or prescriptions — view what the doctor ordered, lab results and dispense status below.
                    </p>
                  </div>
                </div>
                {/* Read-only doctor orders summary */}
                <div className="space-y-2">
                  <div className="text-xs font-extrabold">Lab — doctor ordered + results ({readOnlyLabs.flatMap(r => r.tests).length})</div>
                  {readOnlyLabs.length === 0 ? <div className="text-[11px] text-slate-400">No lab orders for this visit.</div> :
                    readOnlyLabs.flatMap(r => r.tests).map(t => (
                      <div key={t.id} onClick={() => openDetailDialog('lab', t)} className="p-2.5 rounded-xl border text-xs flex justify-between gap-2 bg-slate-50 hover:bg-slate-100 cursor-pointer transition-colors">
                        <div><div className="font-bold">{t.testName}</div>
                          {t.results && t.results.length > 0 && <div className="text-[10px] text-emerald-600 font-bold">✓ Results available</div>}
                          {(!t.results || t.results.length === 0) && <div className="text-[10px] text-amber-600">Pending results</div>}
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full h-fit ${['Released', 'Verified'].includes(t.status) ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{t.status}</span>
                      </div>
                    ))}
                  <div className="text-xs font-extrabold pt-1">Pharmacy — dispense status ({readOnlyRxs.flatMap(r => r.items).length})</div>
                  {readOnlyRxs.length === 0 ? <div className="text-[11px] text-slate-400">No prescriptions for this visit.</div> :
                    readOnlyRxs.flatMap(r => r.items).map(it => (
                      <div key={it.id} onClick={() => openDetailDialog('rx', it)} className={`p-2.5 rounded-xl border text-xs flex justify-between gap-2 ${it.dispenseStatus === 'Dispensed' ? 'bg-emerald-50 border-emerald-300' : 'bg-slate-50'} hover:bg-slate-100 cursor-pointer transition-colors`}>
                        <div className="font-bold">{it.medicationName} <span className="font-normal text-slate-500">({it.dosage} • {it.frequency})</span></div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full h-fit ${it.dispenseStatus === 'Dispensed' ? 'bg-emerald-200 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>{it.dispenseStatus} ({it.quantityDispensed}/{it.quantityPrescribed})</span>
                      </div>
                    ))}
                  <div className="text-xs font-extrabold pt-1">Radiology ({readOnlyRad.length}) • Physiotherapy ({readOnlyPhysio.length})</div>
                  {readOnlyRad.map(o => <div key={o.id} onClick={() => openDetailDialog('rad', o)} className="p-2 rounded-xl border text-xs bg-slate-50 flex justify-between hover:bg-slate-100 cursor-pointer transition-colors"><span className="font-bold">{o.investigationName} ({o.modality})</span><span className="text-[10px] font-bold">{o.status}</span></div>)}
                  {readOnlyPhysio.map(o => <div key={o.id} onClick={() => openDetailDialog('physio', o)} className="p-2 rounded-xl border text-xs bg-slate-50 flex justify-between hover:bg-slate-100 cursor-pointer transition-colors"><span className="font-bold">{o.serviceName} ({o.sessions} sessions)</span><span className="text-[10px] font-bold">{o.status}</span></div>)}
                  {(readOnlyRad.length === 0 && readOnlyPhysio.length === 0) && <div className="text-[11px] text-slate-400">No radiology / physiotherapy orders for this visit.</div>}
                  <p className="text-[11px] text-slate-400 pt-1">Nursing consumables now live under Clinical Care & Triage → Nursing Consumables (after Diagnostic Alerts).</p>
                </div>

              </div>
              )}

            </form>
          ) : (
            <div className="p-12 text-center text-slate-400">Select a visit page to document vitals and view doctor orders.</div>
          )}
        </div>
        </div>
      </div>
      )}

      {/* Patient search dialog */}
      {showPatientSearch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setShowPatientSearch(false)} />
          <div className="relative bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-md border">
            <div className="px-5 py-4 border-b flex items-center justify-between"><h3 className="font-extrabold text-sm flex items-center space-x-2"><User className="w-4 h-4 text-teal-600" /><span>Find Patient</span></h3><button onClick={() => setShowPatientSearch(false)} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button></div>
            <div className="p-4 space-y-2">
              <input autoFocus value={patientSearch} onChange={e => setPatientSearch(e.target.value)} placeholder="Type name, hospital no, phone — list updates as you type..." className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border focus:ring-2 focus:ring-teal-500 focus:outline-none" />
              <div className="max-h-64 overflow-y-auto divide-y rounded-xl border">
                {patientSearchResults.map(p => (
                  <div key={p.id} onClick={() => handlePickPatient(p)} className="px-3 py-2 hover:bg-teal-50 cursor-pointer flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold">{p.firstName} {p.lastName} <span className="font-mono text-[10px] text-teal-600">({p.id})</span></div>
                      <div className="text-[11px] text-slate-500">{p.phone} • {p.sex}, {p.age}y • {db.getVisits(p.id).length} visit(s)</div>
                    </div>
                    {onOpenProfile && <button onClick={(e) => { e.stopPropagation(); onOpenProfile(p); }} className="px-2 py-1 rounded-lg text-[10px] font-bold bg-teal-50 text-teal-700 border border-teal-200 flex-shrink-0">Profile</button>}
                  </div>
                ))}
                {patientSearchResults.length === 0 && <div className="p-4 text-xs text-slate-400 text-center">No matches.</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Detail Dialog for Doctor's Requests */}
      {showDetailDialog && detailDialogData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setShowDetailDialog(false)} />
          <div className="relative bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-lg border max-h-[80vh] flex flex-col">
            <div className="px-5 py-4 border-b flex items-center justify-between flex-shrink-0">
              <h3 className="font-extrabold text-sm flex items-center space-x-2">
                {detailDialogType === 'lab' && <><FlaskConical className="w-4 h-4 text-amber-500" /><span>Lab Test Details</span></>}
                {detailDialogType === 'rx' && <><Pill className="w-4 h-4 text-blue-500" /><span>Prescription Details</span></>}
                {detailDialogType === 'rad' && <><FlaskConical className="w-4 h-4 text-purple-500" /><span>Radiology Order Details</span></>}
                {detailDialogType === 'physio' && <><HeartPulse className="w-4 h-4 text-rose-500" /><span>Physiotherapy Order Details</span></>}
              </h3>
              <button onClick={() => setShowDetailDialog(false)} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              {detailDialogType === 'lab' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between"><span className="text-sm font-extrabold">{detailDialogData.testName}</span><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${['Released', 'Verified'].includes(detailDialogData.status) ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{detailDialogData.status}</span></div>
                  <div className="text-xs text-slate-500">Category: {detailDialogData.category} • Sample: {detailDialogData.sampleType}</div>
                  {detailDialogData.results && detailDialogData.results.length > 0 ? (
                    <div className="space-y-2">
                      <div className="text-xs font-bold text-slate-700">Results:</div>
                      {detailDialogData.results.map((r: any, i: number) => (
                        <div key={i} className="p-2 rounded-lg bg-slate-50 border text-xs">
                          <div className="flex justify-between"><span className="font-bold">{r.parameterName}</span><span className={`text-[10px] font-bold px-1 rounded ${r.flag === 'Normal' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{r.flag}</span></div>
                          <div className="text-slate-600">{r.value} {r.unit} {r.referenceRange && `(Ref: ${r.referenceRange})`}</div>
                          {r.comments && <div className="text-[10px] text-slate-400 italic mt-1">{r.comments}</div>}
                        </div>
                      ))}
                    </div>
                  ) : <div className="text-xs text-slate-400">Results pending...</div>}
                  {detailDialogData.comments && <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded-lg">Notes: {detailDialogData.comments}</div>}
                </div>
              )}
              {detailDialogType === 'rx' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between"><span className="text-sm font-extrabold">{detailDialogData.medicationName}</span><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${detailDialogData.dispenseStatus === 'Dispensed' ? 'bg-emerald-200 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>{detailDialogData.dispenseStatus}</span></div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2 rounded-lg bg-slate-50 border"><div className="text-[10px] font-bold text-slate-400">Dosage</div><div className="font-bold">{detailDialogData.dosage}</div></div>
                    <div className="p-2 rounded-lg bg-slate-50 border"><div className="text-[10px] font-bold text-slate-400">Frequency</div><div className="font-bold">{detailDialogData.frequency}</div></div>
                    <div className="p-2 rounded-lg bg-slate-50 border"><div className="text-[10px] font-bold text-slate-400">Duration</div><div className="font-bold">{detailDialogData.duration}</div></div>
                    <div className="p-2 rounded-lg bg-slate-50 border"><div className="text-[10px] font-bold text-slate-400">Quantity</div><div className="font-bold">{detailDialogData.quantityDispensed}/{detailDialogData.quantityPrescribed}</div></div>
                  </div>
                  {detailDialogData.instructions && <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded-lg">Instructions: {detailDialogData.instructions}</div>}
                </div>
              )}
              {detailDialogType === 'rad' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between"><span className="text-sm font-extrabold">{detailDialogData.investigationName}</span><span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">{detailDialogData.status}</span></div>
                  <div className="text-xs text-slate-500">Modality: {detailDialogData.modality}</div>
                  {detailDialogData.clinicalIndication && <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded-lg">Clinical Indication: {detailDialogData.clinicalIndication}</div>}
                </div>
              )}
              {detailDialogType === 'physio' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between"><span className="text-sm font-extrabold">{detailDialogData.serviceName}</span><span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">{detailDialogData.status}</span></div>
                  <div className="text-xs text-slate-500">Sessions: {detailDialogData.sessions}</div>
                  {detailDialogData.clinicalIndication && <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded-lg">Clinical Indication: {detailDialogData.clinicalIndication}</div>}
                </div>
              )}
            </div>
            <div className="px-5 py-3 bg-slate-50 rounded-b-2xl flex justify-end flex-shrink-0">
              <button onClick={() => setShowDetailDialog(false)} className="px-4 py-2 rounded-xl text-xs font-bold border">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Add visit dialog */}
      {showAddVisit && patient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setShowAddVisit(false)} />
          <div className="relative bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-md border">
            <div className="px-5 py-4 border-b flex items-center justify-between"><h3 className="font-extrabold text-sm">Add Visit — {patient.firstName} {patient.lastName}</h3><button onClick={() => setShowAddVisit(false)} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button></div>
            <div className="p-5 space-y-3">
              <div><label className="block text-xs font-bold mb-1">Visit Type</label><select value={newVisitType} onChange={e => setNewVisitType(e.target.value as any)} className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 border"><option>New Visit</option><option>Follow-up</option><option>Emergency</option><option>Routine</option></select></div>
              <div><label className="block text-xs font-bold mb-1">Reason for Visit</label><input value={newVisitReason} onChange={e => setNewVisitReason(e.target.value)} placeholder="e.g. Fever, routine vitals..." className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 border" /></div>
            </div>
            <div className="px-5 py-3 bg-slate-50 rounded-b-2xl flex justify-end space-x-2"><button onClick={() => setShowAddVisit(false)} className="px-4 py-2 rounded-xl text-xs font-bold border">Cancel</button><button onClick={handleCreateVisit} className="px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white">Create Visit Page</button></div>
          </div>
        </div>
      )}

      {/* Admit dialog — ward must be specified */}
      {showAdmit && activeVisit && activePatient && (
        <AdmitDialog
          title={`Admit ${activePatient.firstName} ${activePatient.lastName}`}
          subtitle={`Visit ${activeVisit.visitDate} • ${activeVisit.visitType}`}
          onClose={() => setShowAdmit(false)}
          onConfirm={(ward) => {
            try {
              db.admitVisit(activeVisit.id, ward, currentUser);
              setShowAdmit(false);
            } catch (err: any) {
              alert(err.message);
            }
          }}
        />
      )}
    </div>
  );
};
