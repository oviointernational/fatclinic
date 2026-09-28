import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Patient, Visit, ClinicalDiagnosis, LabCategory, LabInvestigationDefinition, Medication, wardName } from '../../types';
import { db } from '../../services/db';
import { useCurrentUser } from '../../context/AuthContext';
import { useSyncDb } from '../../hooks/useSyncDb';
import { aiService } from '../../services/aiService';
import { mayDoctorWrite, readOnlyReason } from '../../services/consultationAccess';
import { formatSurgeryHistory, type SurgeryHistoryEntry } from '../../services/surgeryHistory';
import { classifyExamEntry, isAdditionalFindings } from '../../services/physicalExam';
import {
  entryText,
  foldHistory,
  foldImpression,
  foldNotes,
  foldPlan,
  seedComplaintEntries,
  seedDiagnosisEntries,
  seedExamEntries,
  seedManagementEntries,
  seedSurgeryEntries,
  type DiagnosisEntry,
  type EntryItem,
  type ManagementEntry,
} from '../../services/consultationSeed';
import { AdmitDialog } from './AdmitDialog';
import {
  Stethoscope,
  Sparkles,
  Plus,
  Trash2,
  Save,
  FlaskConical,
  Pill,
  CheckCircle2,
  User,
  Calendar,
  AlertTriangle,
  Clock,
  Heart,
  Activity,
  Thermometer,
  Droplet,
  Weight,
  Phone,
  MapPin,
  ShieldAlert,
  FileText,
  Layers,
  Edit3,
  X,
  Beaker,
  ClipboardList,
  HeartPulse,
  UserCheck,
  Bed,
  FilePlus2,
  Timer,
  Bookmark,
  Package,
  Maximize2,
  Minimize2,
   Users,
   Search,
   ListChecks,
   Lock
 } from 'lucide-react';

interface ConsultationFormProps {
  patient: Patient | null;
  visit?: Visit;
  onSaved?: () => void;
  onSelectPatient?: (patient: Patient) => void;
  onOpenProfile?: (patient: Patient) => void;
  isWideMode?: boolean;
  onToggleWideMode?: () => void;
  activeSubNav?: string;
}

interface LabOrderItem {
  id: string;
  testDefinitionId: string;
  testName: string;
  category: LabCategory;
  price: number;
  sampleType: string;
  priority: 'Routine' | 'Urgent' | 'STAT';
  notes?: string;
}

const DEPARTMENTS: Array<{
  id: LabCategory;
  label: string;
  shortName: string;
  color: string;
  badgeBg: string;
  badgeText: string;
  borderActive: string;
}> = [
  { id: 'HEMATOLOGY', label: '1. Hematology', shortName: 'Hematology', color: 'bg-rose-600', badgeBg: 'bg-rose-50 dark:bg-rose-950/60', badgeText: 'text-rose-700 dark:text-rose-300', borderActive: 'border-rose-400 dark:border-rose-700' },
  { id: 'MICROBIOLOGY', label: '2. Medical Microbiology', shortName: 'Microbiology', color: 'bg-amber-600', badgeBg: 'bg-amber-50 dark:bg-amber-950/60', badgeText: 'text-amber-700 dark:text-amber-300', borderActive: 'border-amber-400 dark:border-amber-700' },
  { id: 'CHEMICAL_PATHOLOGY', label: '3. Chemical Pathology', shortName: 'Chemical Path', color: 'bg-teal-600', badgeBg: 'bg-teal-50 dark:bg-teal-950/60', badgeText: 'text-teal-700 dark:text-teal-300', borderActive: 'border-teal-400 dark:border-teal-700' },
  { id: 'HISTOPATHOLOGY', label: '4. Histopathology & Cytology', shortName: 'Histopathology', color: 'bg-purple-600', badgeBg: 'bg-purple-50 dark:bg-purple-950/60', badgeText: 'text-purple-700 dark:text-purple-300', borderActive: 'border-purple-400 dark:border-purple-700' },
  { id: 'MOLECULAR', label: '5. Molecular Biology', shortName: 'Molecular', color: 'bg-indigo-600', badgeBg: 'bg-indigo-50 dark:bg-indigo-950/60', badgeText: 'text-indigo-700 dark:text-indigo-300', borderActive: 'border-indigo-400 dark:border-indigo-700' }
];

// The generic entry types are imported from services/consultationSeed, which owns
// them because it owns the seeding. `SurgeryHistoryEntry` is imported from
// services/surgeryHistory, which owns that shape because it also owns the
// serialisation into the single text column. A second, local copy of an interface
// is a second thing to forget to update.

export const ConsultationForm: React.FC<ConsultationFormProps> = ({
  patient: initialPatient,
  visit: initialVisit,
  onSaved,
  onSelectPatient,
  onOpenProfile,
  isWideMode = false,
  onToggleWideMode,
  activeSubNav
}) => {
  const currentUser = useCurrentUser();
  const syncTick = useSyncDb();

  const allPatients = db.getPatients();
  const [currentPatientId, setCurrentPatientId] = useState<string>(initialPatient?.id || '');
  const patient = allPatients.find(p => p.id === currentPatientId) || initialPatient || null;

  const visits = patient ? db.getVisits(patient.id) : [];
  const [currentVisitId, setCurrentVisitId] = useState<string>(initialVisit?.id || '');
  const activeVisit = visits.find(v => v.id === currentVisitId) || initialVisit || visits[0] || undefined;

  /**
   * Whether this clinician may add anything to the record in front of them.
   *
   * Keyed on the *selected* visit, not on the patient's latest one. The visit
   * dropdown lists every visit the patient has ever had, so a patient whose
   * current visit is waiting for vitals can still have a closed visit selected
   * from before - and "the latest visit is fine" would then wave that through.
   *
   * This is the enforcement point. The patient list already refused to open a
   * patient who had not been sent, but that was a filter on one screen: the
   * component still rendered a fully editable consultation form, the Save button
   * was live, and the dialogs for complaints, examination, diagnoses, lab orders
   * and prescriptions all opened. Anything that reached the form - the initial
   * patient passed in by the dashboard, a deep link, the browser's own back
   * button - could be typed into and saved. A gate that only exists on the list
   * is a gate with no door in it.
   */
  const canWrite = mayDoctorWrite(activeVisit);
  const gateReason = readOnlyReason(activeVisit);

  const [showPatientSearch, setShowPatientSearch] = useState(false);
  const [patientSearch, setPatientSearch] = useState('');
  const [progressPatientId, setProgressPatientId] = useState<string | null>(null);
  const [showAdmit, setShowAdmit] = useState(false);

  // Care-progress checklist for the list view (latest visit per patient).
  // Done items render light-green; pending items render neutral.
  const getPhysicianChecklist = (p: Patient): Array<{ label: string; done: boolean; detail: string }> => {
    const latestVisit = db.getVisits(p.id)[0];
    if (!latestVisit) {
      return [
        { label: "Patient's Info", done: true, detail: `${p.sex}, ${p.age}y • ${p.id}` },
        { label: 'Vitals', done: false, detail: 'No visit yet' },
        { label: 'Complaint & History', done: false, detail: 'Not started' },
        { label: 'Physical Examination', done: false, detail: 'Not started' },
        { label: 'Surgery History', done: false, detail: 'Not started' },
        { label: 'Diagnosis (ICD-10)', done: false, detail: 'Not started' },
        { label: 'Lab Orders', done: false, detail: 'Not started' },
        { label: 'Prescriptions', done: false, detail: 'Not started' },
        { label: 'Radiology', done: false, detail: 'Not started' },
        { label: 'Physiotherapy', done: false, detail: 'Not started' },
        { label: 'Management Plan', done: false, detail: 'Not started' },
      ];
    }
    const vitalsRec = db.getVitals(latestVisit.id, p.id)[0];
    const cons = db.getConsultation(latestVisit.id);
    const labs = db.getLabRequests({ visitId: latestVisit.id });
    const labsWithResult = labs.filter(r => r.tests.some(t => ['Released', 'Verified'].includes(t.status))).length;
    const rxs = db.getPrescriptions(p.id, latestVisit.id);
    const rad = db.getRadiologyOrders(p.id, latestVisit.id);
    const physio = db.getPhysiotherapyOrders(p.id, latestVisit.id);
    const pe: any = (cons as any)?.physicalExamination;
    const peDone = !!cons && (!!cons.clinicalFindings || (pe && Object.values(pe).some(v => !!v && String(v).trim() !== '')));
    const complaintDone = !!cons && (!!cons.presentingComplaint || !!cons.historyOfPresentingComplaint || !!cons.pastMedicalHistory);
    return [
      { label: "Patient's Info", done: true, detail: `${p.sex}, ${p.age}y • Visit ${latestVisit.visitDate} (${latestVisit.status})` },
      { label: 'Vitals', done: !!vitalsRec, detail: vitalsRec ? `BP ${vitalsRec.systolicBp}/${vitalsRec.diastolicBp} • SpO2 ${vitalsRec.spo2}%` : 'Not recorded by nurse' },
      { label: 'Complaint & History', done: complaintDone, detail: complaintDone ? 'Documented' : 'Not documented' },
      { label: 'Physical Examination', done: peDone, detail: peDone ? 'Findings recorded' : 'No findings yet' },
      { label: 'Surgery History', done: !!cons?.surgicalHistory?.trim(), detail: cons?.surgicalHistory ? 'Recorded' : 'Not recorded' },
      { label: 'Diagnosis (ICD-10)', done: (cons?.diagnoses?.length || 0) > 0, detail: cons?.diagnoses?.length ? `${cons.diagnoses.length} code(s)` : 'No diagnosis yet' },
      { label: 'Lab Orders', done: labs.length > 0, detail: labs.length ? `${labs.length} order(s)${labsWithResult ? ` • ${labsWithResult} result(s) ready` : ''}` : 'None ordered' },
      { label: 'Prescriptions', done: rxs.length > 0, detail: rxs.length ? `${rxs.length} prescription(s)` : 'None prescribed' },
      { label: 'Radiology', done: rad.length > 0, detail: rad.length ? `${rad.length} order(s)` : 'None ordered' },
      { label: 'Physiotherapy', done: physio.length > 0, detail: physio.length ? `${physio.length} order(s)` : 'None ordered' },
      { label: 'Management Plan', done: !!cons?.plan?.trim(), detail: cons?.plan ? 'Plan documented' : 'No plan yet' },
    ];
  };

  React.useEffect(() => {
    if (initialPatient && !currentPatientId) setCurrentPatientId(initialPatient.id);
  }, [initialPatient?.id]);
  React.useEffect(() => {
    if (initialVisit && !currentVisitId) setCurrentVisitId(initialVisit.id);
  }, [initialVisit?.id]);

  // Switching queue submenu (All / Awaiting / Consulted / Incoming) always
  // shows the filtered patient list first — clear any open patient details.
  React.useEffect(() => {
    setCurrentPatientId('');
    setCurrentVisitId('');
    setPatientSearch('');
    setProgressPatientId(null);
  }, [activeSubNav]);

  const patientSearchResults = React.useMemo(() => {
    const q = patientSearch.trim().toLowerCase();
    const today = new Date().toISOString().split('T')[0];
    let pool: Patient[] = [];

    if (!activeSubNav || activeSubNav === 'consultations_all' || activeSubNav === 'consultations') {
      // All patients from directory
      pool = q ? db.searchPatients(patientSearch) : allPatients;
    } else if (activeSubNav === 'consultations_awaiting') {
      // Patients sent by nurse, waiting for physician
      const awaitingIds = new Set(
        db.getVisits().filter(v => v.visitDate === today && ['With Doctor', 'Awaiting Physician', 'Awaiting Lab', 'Awaiting Pharmacy'].includes(v.status)).map(v => v.patientId)
      );
      pool = q ? db.searchPatients(patientSearch).filter(p => awaitingIds.has(p.id)) : allPatients.filter(p => awaitingIds.has(p.id));
    } else if (activeSubNav === 'consultations_consulted') {
      // Patients the doctor attended today
      const consultedIds = new Set(
        db.getVisits().filter(v => v.visitDate === today && v.status === 'In Consultation').map(v => v.patientId)
      );
      pool = q ? db.searchPatients(patientSearch).filter(p => consultedIds.has(p.id)) : allPatients.filter(p => consultedIds.has(p.id));
    } else if (activeSubNav === 'consultations_incoming') {
      // Patients not yet sent by nurse (still With Nurse or Awaiting Vitals)
      const incomingIds = new Set(
        db.getVisits().filter(v => v.visitDate === today && ['Awaiting Vitals', 'With Nurse'].includes(v.status)).map(v => v.patientId)
      );
      pool = q ? db.searchPatients(patientSearch).filter(p => incomingIds.has(p.id)) : allPatients.filter(p => incomingIds.has(p.id));
    } else {
      pool = q ? db.searchPatients(patientSearch) : allPatients;
    }

    return pool.slice(0, q ? 12 : 8);
  }, [patientSearch, activeSubNav, syncTick]);

  const existingConsultation = activeVisit ? db.getConsultation(activeVisit.id) : undefined;
  const vitals = activeVisit && patient ? db.getVitals(activeVisit.id, patient.id)[0] : undefined;



  // ---- dynamic entries initialisation ----
  //
  // The seeding itself lives in src/services/consultationSeed.ts, not here,
  // because it could not be tested from in here - and it was wrong. See the note
  // at the top of that file: a visit with no consultation yet used to be seeded
  // with a fabricated malaria diagnosis, so pressing Save on an untouched
  // consultation wrote invented clinical data into the patient's record.
  //
  // The Surgery History tab is read back out of the single text column, which is
  // the other half of that tab not saving: it used to start empty and stay empty
  // across page loads, so there was nothing to seed it from even once the save
  // had written something.
  const initComplaint = (): EntryItem[] => seedComplaintEntries(existingConsultation);
  const initExam = (): EntryItem[] => seedExamEntries(existingConsultation);
  const initDiagnosis = (): DiagnosisEntry[] => seedDiagnosisEntries(existingConsultation);
  const initManagement = (): ManagementEntry[] => seedManagementEntries(existingConsultation);
  const initSurgery = (): SurgeryHistoryEntry[] => seedSurgeryEntries(existingConsultation);
  const [complaintEntries, setComplaintEntries] = useState<EntryItem[]>(initComplaint());
  const [examEntries, setExamEntries] = useState<EntryItem[]>(initExam());
  const [diagnosisEntries, setDiagnosisEntries] = useState<DiagnosisEntry[]>(initDiagnosis());
  const [managementEntries, setManagementEntries] = useState<ManagementEntry[]>(initManagement());
  const [surgeryEntries, setSurgeryEntries] = useState<SurgeryHistoryEntry[]>(initSurgery());

  /**
   * Re-seed every entry list when the record on screen changes.
   *
   * `useState`'s argument is an initialiser: it runs on mount and never again.
   * The component stays mounted while the doctor moves between patients and
   * between a patient's visits, so all five lists kept the *previous* patient's
   * contents. Selecting a second patient showed the first patient's complaint,
   * examination, diagnoses and plan, and pressing Save wrote them onto the second
   * patient's record under the second patient's name - one keystroke, and one
   * patient's history written onto another's. The visit dropdown made the same
   * trap available within a single patient.
   *
   * The key is the visit, because that is the unit the consultation is keyed on:
   * `db.getConsultation` looks it up by visit, and the complaint, examination,
   * diagnoses and plan all belong to that visit rather than to the person.
   */
  /**
   * Shut any open editor if the record stops being writable.
   *
   * The gate can flip while a dialog is on screen: a nurse sends the patient
   * through, or the doctor switches to a different visit from the dropdown, or a
   * colleague marks the visit treated. A dialog that was legitimately open when
   * the record became read-only would otherwise still be open, still accepting
   * text, and its Save would write to a record that is no longer the doctor's to
   * write to.
   */
  useEffect(() => {
    if (canWrite) return;
    setShowComplaintDlg(false);
    setShowExamDlg(false);
    setShowSurgeryDlg(false);
    setShowDiagDlg(false);
    setShowLabDlg(false);
    setShowRxDlg(false);
    setShowMgmtDlg(false);
    setShowNextAppt(false);
    setAiSuggestions([]);
  }, [canWrite]);

  /**
   * A refusal is cleared the moment the gate opens.
   *
   * The visit dropdown lists every visit a patient has ever had, and a doctor
   * refused on the visit still waiting for nursing can move straight to the one
   * they were sent. The message they were given - "this patient has not been sent
   * to a doctor yet" - is then not merely stale but false, and it sits above the
   * Save button of a form that is now perfectly writable. A warning that outlives
   * the thing it warned about trains people to ignore warnings.
   */
  useEffect(() => {
    if (canWrite) {
      setSaveBlocked(null);
      setSaveBlockedKind('blocked');
    }
  }, [canWrite]);

  const seededFor = useRef<string>('');
  useEffect(() => {
    const key = activeVisit?.id ?? `no-visit:${currentPatientId}`;
    if (seededFor.current === key) return;
    seededFor.current = key;
    setComplaintEntries(initComplaint());
    setExamEntries(initExam());
    setDiagnosisEntries(initDiagnosis());
    setManagementEntries(initManagement());
    setSurgeryEntries(initSurgery());
    // Deliberately keyed on the visit alone. `initComplaint` and friends close
    // over `existingConsultation`, which is derived from the same visit, so
    // listing it would be listing the same thing twice; the ref is what makes
    // this run once per visit rather than on every render of that visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVisit?.id, currentPatientId]);

  // fallback old state for save compatibility still kept as derived
  const complaint = useMemo(() => complaintEntries.map(e => `${e.title}: ${entryText(e)}`).join('\n'), [complaintEntries]);
  const hpc = useMemo(() => { const f = complaintEntries.find(e=>e.title.toLowerCase().includes('history of presenting')); return f?f.body:'' }, [complaintEntries]);
  /**
   * The examination, folded from the titled entries into the seven columns.
   *
   * `classifyExamEntry` decides the column. The old inline substring matching put
   * Gastrointestinal and Neurological findings into "other" - the two systems the
   * dialog offers whose names contain neither of the substrings it looked for -
   * and also appended the additional-findings entry to "other", storing the same
   * text in two columns on every save.
   */
  const examMap = useMemo(() => {
    const m: Record<string, string> = {};
    const append = (key: string, line: string) => {
      m[key] = m[key] ? `${m[key]}\n${line}` : line;
    };
    examEntries.forEach((e) => {
      if (isAdditionalFindings(e.title)) return; // its own column, read below
      const column = classifyExamEntry(e.title);
      // A recognised system stores just the finding, so a reload reads back as
      // one entry per system. Anything filed under "other" keeps its title, or the
      // column would come back as a run-on sentence with no way to tell where one
      // finding ended and the next began.
      append(column, column === 'other' ? `${e.title}: ${e.body}` : e.body);
    });
    return m;
  }, [examEntries]);

  // diagnoses derived for save
  const diagnoses: ClinicalDiagnosis[] = useMemo(()=> diagnosisEntries.filter(d=>d.isCoded).map(d=>({id:d.id, code:d.code||'R69', description:d.title, type:d.type})), [diagnosisEntries]);
  /**
   * The impression and the plan, folded under their own titles.
   *
   * `stripTitlePrefix` is what stops the column growing a prefix on every save:
   * the seed reads the stored value back as one entry whose body is the whole
   * string, title included, so re-saving produced "Treatment Plan: Treatment
   * Plan: Appendicectomy..." and the next save another one. Both live in the
   * seeded module now, where the round trip can be checked.
   */
  const assessment = useMemo(()=> {
    const imp = foldImpression(diagnosisEntries);
    const fallback = diagnosisEntries.filter(d=>d.isCoded).map(d=> `${d.title} (${d.code})`).join('; ');
    return imp || fallback;
  }, [diagnosisEntries]);
  const plan = useMemo(()=> foldPlan(managementEntries), [managementEntries]);
  const followUpDate = useMemo(()=> managementEntries.find(m=>m.date)?.date || '', [managementEntries]);
  const clinicalNotes = useMemo(()=> foldNotes(managementEntries), [managementEntries]);
  const clinicalFindings = useMemo(()=> examEntries.find(e=>isAdditionalFindings(e.title))?.body || '', [examEntries]);

  // lab & rx state
  const [orderedLabTests, setOrderedLabTests] = useState<LabOrderItem[]>([]);
  const [currentPriority, setCurrentPriority] = useState<'Routine' | 'Urgent' | 'STAT'>('Urgent');
  const [orderClinicalNotes, setOrderClinicalNotes] = useState('');
  const [rxItems, setRxItems] = useState<Array<{ medId: string; dosage: string; route: string; frequency: string; duration: string; quantity: number; instructions: string; }>>([]);

  const [savedSuccess, setSavedSuccess] = useState(false);
  /** Set when a save was refused by the gate, so the doctor is told why. */
  const [saveBlocked, setSaveBlocked] = useState<string | null>(null);
  /**
   * Whether the message above the Save button is about a save that was refused
   * or about an editor that would not open. Same reason, two different sentences:
   * "Not saved." is alarming and, after a click that never opened anything,
   * untrue.
   */
  const [saveBlockedKind, setSaveBlockedKind] = useState<'refused' | 'blocked'>('blocked');
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [activeAiField, setActiveAiField] = useState<'complaint' | 'exam' | 'plan' | 'diagnosis' | null>(null);

  const labDefs = db.getLabInvestigations();
  const medications = db.getMedications();
  const settings = db.getSettings();

  // dialog states
  const [showComplaintDlg, setShowComplaintDlg] = useState(false);
  const [complaintDlgTitle, setComplaintDlgTitle] = useState('');
  const [complaintDlgComplaint, setComplaintDlgComplaint] = useState('');
  const [complaintDlgBody, setComplaintDlgBody] = useState('');
  const [editingComplaintId, setEditingComplaintId] = useState<string | null>(null);

  const [showExamDlg, setShowExamDlg] = useState(false);
  const [examDlgSystem, setExamDlgSystem] = useState('General');
  const [examDlgTitle, setExamDlgTitle] = useState('');
  const [examDlgBody, setExamDlgBody] = useState('');
  const [editingExamId, setEditingExamId] = useState<string | null>(null);

  const EXAM_SYSTEMS = ['General', 'Cardiovascular', 'Respiratory', 'Gastrointestinal', 'Neurological', 'Musculoskeletal', 'Genitourinary', 'Integumentary', 'Endocrine', 'Hematological', 'Psychiatric'];

  const [showDiagDlg, setShowDiagDlg] = useState(false);
  const [diagDlgTitle, setDiagDlgTitle] = useState('');
  const [diagDlgBody, setDiagDlgBody] = useState('');
  const [diagDlgIsCoded, setDiagDlgIsCoded] = useState(true);
  const [diagDlgCode, setDiagDlgCode] = useState('');
  const [diagDlgType, setDiagDlgType] = useState<'Primary' | 'Secondary'>('Secondary');
  const [editingDiagId, setEditingDiagId] = useState<string | null>(null);

  const [showLabDlg, setShowLabDlg] = useState(false);
  const [labDlgDept, setLabDlgDept] = useState<LabCategory>('HEMATOLOGY');
  const [labDlgSelectedIds, setLabDlgSelectedIds] = useState<string[]>([]);
  const [labDlgPick, setLabDlgPick] = useState<string>('');
  const [labDlgPriority, setLabDlgPriority] = useState<'Routine' | 'Urgent' | 'STAT'>('Urgent');
  const [labDlgNotes, setLabDlgNotes] = useState('');

  const [showRxDlg, setShowRxDlg] = useState(false);
  const [rxDlgMedId, setRxDlgMedId] = useState<string>(medications[0]?.id || '');
  const [rxDlgDosage, setRxDlgDosage] = useState('1 tablet');
  const [rxDlgRoute, setRxDlgRoute] = useState('Oral');
  const [rxDlgFrequency, setRxDlgFrequency] = useState('BD (Twice daily)');
  const [rxDlgDuration, setRxDlgDuration] = useState('5 days');
  const [rxDlgQuantity, setRxDlgQuantity] = useState(10);
  const [rxDlgInstructions, setRxDlgInstructions] = useState('Take after meals with water');
  // staging for multiple at once inside dialog
  const [rxStaging, setRxStaging] = useState<Array<{ medId:string; dosage:string; route:string; frequency:string; duration:string; quantity:number; instructions:string }>>([]);

  const [showMgmtDlg, setShowMgmtDlg] = useState(false);
  const [mgmtDlgTitle, setMgmtDlgTitle] = useState('Treatment Plan');
  const [mgmtDlgBody, setMgmtDlgBody] = useState('');
  const [mgmtDlgDate, setMgmtDlgDate] = useState('');
  const [mgmtDlgCategory, setMgmtDlgCategory] = useState('Therapeutics');
  const [mgmtDlgPriority, setMgmtDlgPriority] = useState('Routine');
  const [editingMgmtId, setEditingMgmtId] = useState<string | null>(null);

  // Next appointment (only doctor can create)
  const [nextApptDate, setNextApptDate] = useState('');
  const [nextApptReason, setNextApptReason] = useState('');
  const [showNextAppt, setShowNextAppt] = useState(false);

  // Surgery history
  const [showSurgeryDlg, setShowSurgeryDlg] = useState(false);
  const [surgeryDlgDate, setSurgeryDlgDate] = useState('');
  const [surgeryDlgHospital, setSurgeryDlgHospital] = useState('');
  const [surgeryDlgType, setSurgeryDlgType] = useState('');
  const [surgeryDlgNotes, setSurgeryDlgNotes] = useState('');
  const [editingSurgeryId, setEditingSurgeryId] = useState<string | null>(null);

  const openSurgeryAdd = () => { if (refuseIfReadOnly()) return; setSurgeryDlgDate(''); setSurgeryDlgHospital(''); setSurgeryDlgType(''); setSurgeryDlgNotes(''); setEditingSurgeryId(null); setShowSurgeryDlg(true); };
  const openSurgeryEdit = (s: SurgeryHistoryEntry) => { if (refuseIfReadOnly()) return; setSurgeryDlgDate(s.date); setSurgeryDlgHospital(s.hospital); setSurgeryDlgType(s.surgeryType); setSurgeryDlgNotes(s.notes); setEditingSurgeryId(s.id); setShowSurgeryDlg(true); };
  const saveSurgery = () => {
    if(!surgeryDlgType.trim()) return;
    const entry: SurgeryHistoryEntry = { id: editingSurgeryId||'surg-'+Date.now(), date: surgeryDlgDate, hospital: surgeryDlgHospital, surgeryType: surgeryDlgType, notes: surgeryDlgNotes };
    if(editingSurgeryId) setSurgeryEntries(prev=> prev.map(x=> x.id===editingSurgeryId? entry: x));
    else setSurgeryEntries(prev=> [...prev, entry]);
    setShowSurgeryDlg(false);
  };

  const handleAiAutocomplete = (field: 'complaint' | 'exam' | 'plan' | 'diagnosis') => {
    if (refuseIfReadOnly()) return;
    setActiveAiField(field);
    const suggestions = aiService.getAutocompleteSuggestions(field, field === 'complaint' ? complaint : '');
    setAiSuggestions(suggestions);
  };
  const applyAiSuggestion = (suggestion: string) => {
    if (refuseIfReadOnly()) return;
    if (activeAiField === 'complaint') {
      const parts = suggestion.split(':');
      setComplaintEntries(prev => [...prev, { id: 'ai-'+Date.now(), title: parts[0]?.trim() || 'AI Suggestion', body: parts[1]?.trim() || suggestion }]);
    } else if (activeAiField === 'exam') setExamEntries(prev => [...prev, { id:'ai-'+Date.now(), title:'AI Exam Finding', body: suggestion }]);
    else if (activeAiField === 'plan') setManagementEntries(prev => [...prev, { id:'ai-'+Date.now(), title:'AI Plan', body: suggestion, category:'AI' }]);
    else if (activeAiField === 'diagnosis') {
      const parts = suggestion.split('(ICD-10: ');
      const desc = parts[0].trim();
      const code = parts[1] ? parts[1].replace(')', '').trim() : 'ICD-10';
      setDiagnosisEntries(prev => [...prev, { id: 'diag-'+Date.now(), title:desc, body:desc, isCoded:true, code, type: prev.some(d=>d.type==='Primary')?'Secondary':'Primary' }]);
    }
    setAiSuggestions([]);
    setActiveAiField(null);
  };

  // complaint handlers
  /**
   * Refuse to start an edit while this record is read-only.
   *
   * Placed on the handlers rather than on the eleven buttons that call them,
   * because a button is a presentation detail and a handler is the thing that
   * actually opens an editor. Guarding the buttons would mean eleven chances to
   * forget one, and a forgotten button is a working editor on a read-only record
   * - which is the exact hole this gate was written to close. Returns true when
   * the caller should stop, and says why on screen.
   */
  const refuseIfReadOnly = (): boolean => {
    if (canWrite) return false;
    // 'refused', not 'blocked': the doctor asked to *open* an editor, and since
    // it never opened there was nothing to save. The banner says "Not saved" for
    // a genuinely blocked save, where the doctor did believe their work had been
    // written - and a warning that turns out to be about something that never
    // happened is how the real one gets ignored.
    setSaveBlockedKind('refused');
    setSaveBlocked(gateReason);
    return true;
  };

  const openComplaintAdd = () => { if (refuseIfReadOnly()) return; setComplaintDlgTitle(''); setComplaintDlgComplaint(''); setComplaintDlgBody(''); setEditingComplaintId(null); setShowComplaintDlg(true); };
  const openComplaintEdit = (e: EntryItem) => { if (refuseIfReadOnly()) return; setComplaintDlgTitle(e.title); setComplaintDlgComplaint(e.complaint || ''); setComplaintDlgBody(e.body); setEditingComplaintId(e.id); setShowComplaintDlg(true); };
  const saveComplaint = () => {
    if(!complaintDlgTitle.trim() || !complaintDlgBody.trim()) return;
    if(editingComplaintId){
      setComplaintEntries(prev=> prev.map(x=> x.id===editingComplaintId? { ...x, title:complaintDlgTitle, complaint:complaintDlgComplaint, body:complaintDlgBody }:x));
    } else {
      setComplaintEntries(prev=> [...prev, { id:'ce-'+Date.now(), title:complaintDlgTitle, complaint:complaintDlgComplaint, body:complaintDlgBody }]);
    }
    setShowComplaintDlg(false);
  };

  // exam handlers
  const openExamAdd = () => { if (refuseIfReadOnly()) return; setExamDlgSystem('General'); setExamDlgTitle(''); setExamDlgBody(''); setEditingExamId(null); setShowExamDlg(true); };
  const openExamEdit = (e: EntryItem) => { if (refuseIfReadOnly()) return; setExamDlgSystem(e.title.split(' - ')[0] || 'General'); setExamDlgTitle(e.title.split(' - ')[1] || e.title); setExamDlgBody(e.body); setEditingExamId(e.id); setShowExamDlg(true); };
  const saveExam = () => {
    if(!examDlgTitle.trim() || !examDlgBody.trim()) return;
    const fullTitle = `${examDlgSystem} - ${examDlgTitle}`;
    if(editingExamId) setExamEntries(prev=> prev.map(x=> x.id===editingExamId?{...x,title:fullTitle, body:examDlgBody}:x));
    else setExamEntries(prev=> [...prev,{id:'ex-'+Date.now(), title:fullTitle, body:examDlgBody}]);
    setShowExamDlg(false);
  };

  // diagnosis handlers
  const openDiagAdd = () => { if (refuseIfReadOnly()) return; setDiagDlgTitle(''); setDiagDlgBody(''); setDiagDlgIsCoded(true); setDiagDlgCode(''); setDiagDlgType(diagnosisEntries.some(d=>d.type==='Primary')?'Secondary':'Primary'); setEditingDiagId(null); setShowDiagDlg(true); };
  const openDiagEdit = (d: DiagnosisEntry) => { if (refuseIfReadOnly()) return; setDiagDlgTitle(d.title); setDiagDlgBody(d.body); setDiagDlgIsCoded(d.isCoded); setDiagDlgCode(d.code); setDiagDlgType(d.type); setEditingDiagId(d.id); setShowDiagDlg(true); };
  const saveDiag = () => {
    if(!diagDlgTitle.trim()) return;
    if(diagDlgIsCoded && !diagDlgCode.trim()) return;
    const entry: DiagnosisEntry = { id: editingDiagId||'dg-'+Date.now(), title:diagDlgTitle, body:diagDlgBody||diagDlgTitle, isCoded:diagDlgIsCoded, code: diagDlgIsCoded? diagDlgCode:'', type: diagDlgType };
    if(editingDiagId) setDiagnosisEntries(prev=> prev.map(x=> x.id===editingDiagId? entry: x));
    else setDiagnosisEntries(prev=> [...prev, entry]);
    setShowDiagDlg(false);
  };

  // lab dialog handlers
  const openLabDlg = () => { if (refuseIfReadOnly()) return;
    setLabDlgSelectedIds([]);
    const first = labDefs.find(d=> d.category===labDlgDept)?.id || labDefs[0]?.id || '';
    setLabDlgPick(first);
    setLabDlgPriority(currentPriority);
    setLabDlgNotes(orderClinicalNotes);
    setShowLabDlg(true);
  };
  const handleLabDropdownAdd = () => {
    if (!labDlgPick) return;
    if (labDlgSelectedIds.includes(labDlgPick)) return;
    setLabDlgSelectedIds(prev=> [...prev, labDlgPick]);
  };
  const confirmLabAdd = () => {
    const selectedDefs = labDefs.filter(d=> labDlgSelectedIds.includes(d.id));
    const newItems: LabOrderItem[] = selectedDefs.map(def=>({
      id:'LOI-'+Date.now()+'-'+Math.random().toString(36).substring(2,6),
      testDefinitionId: def.id, testName: def.name, category: def.category, price: def.price, sampleType: def.sampleType, priority: labDlgPriority, notes: labDlgNotes|| undefined
    }));
    setOrderedLabTests(prev=> [...prev, ...newItems]);
    setCurrentPriority(labDlgPriority);
    if(labDlgNotes) setOrderClinicalNotes(labDlgNotes);
    setShowLabDlg(false);
  };

  // rx dialog handlers
  const openRxDlg = () => { if (refuseIfReadOnly()) return;
    setRxDlgMedId(medications[0]?.id || '');
    setRxDlgDosage('1 tablet'); setRxDlgRoute('Oral'); setRxDlgFrequency('BD (Twice daily)'); setRxDlgDuration('5 days'); setRxDlgQuantity(10); setRxDlgInstructions('Take after meals with water');
    setRxStaging([]);
    setShowRxDlg(true);
  };
  const stageRx = () => {
    setRxStaging(prev=> [...prev, { medId: rxDlgMedId, dosage: rxDlgDosage, route: rxDlgRoute, frequency: rxDlgFrequency, duration: rxDlgDuration, quantity: rxDlgQuantity, instructions: rxDlgInstructions }]);
  };
  const confirmRx = () => {
    if(rxStaging.length>0){
      setRxItems(prev=> [...prev, ...rxStaging]);
    } else {
      // if nothing staged but form is filled, treat as one add
      setRxItems(prev=> [...prev, { medId: rxDlgMedId, dosage: rxDlgDosage, route: rxDlgRoute, frequency: rxDlgFrequency, duration: rxDlgDuration, quantity: rxDlgQuantity, instructions: rxDlgInstructions }]);
    }
    setShowRxDlg(false);
  };

  // management handlers
  const openMgmtAdd = () => { if (refuseIfReadOnly()) return; setMgmtDlgTitle('Treatment Plan'); setMgmtDlgBody(''); setMgmtDlgDate(''); setMgmtDlgCategory('Therapeutics'); setMgmtDlgPriority('Routine'); setEditingMgmtId(null); setShowMgmtDlg(true); };
  const openMgmtEdit = (m: ManagementEntry)=>{ if (refuseIfReadOnly()) return; setMgmtDlgTitle(m.title); setMgmtDlgBody(m.body); setMgmtDlgDate(m.date||''); setMgmtDlgCategory(m.category||'Therapeutics'); setEditingMgmtId(m.id); setShowMgmtDlg(true); };
  const saveMgmt = () => {
    if(!mgmtDlgTitle.trim() || !mgmtDlgBody.trim()) return;
    const entry: ManagementEntry = { id: editingMgmtId||'mg-'+Date.now(), title: mgmtDlgTitle, body: mgmtDlgBody, date: mgmtDlgDate, category: mgmtDlgCategory, priority: mgmtDlgPriority };
    if(editingMgmtId) setManagementEntries(prev=> prev.map(x=> x.id===editingMgmtId? entry: x));
    else setManagementEntries(prev=> [...prev, entry]);
    setShowMgmtDlg(false);
  };

  const handleSaveConsultation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!patient || !activeVisit) return;
    // The gate, enforced at the point of the write rather than only by hiding the
    // button. The button is disabled and the dialogs are closed when the patient
    // has not been sent, so reaching this with `!canWrite` means the two got out
    // of step - and the right response to that is to refuse the write, not to
    // save it. A record that must not exist should not be one keystroke away.
    if (!canWrite) {
      setSavedSuccess(false);
      setSaveBlockedKind('blocked');
      setSaveBlocked(gateReason);
      return;
    }
    setSaveBlocked(null);
    /**
     * The seven history columns, folded from the titled entries.
     *
     * This used to be six inline `find(...)?.body` expressions, and `body` only.
     * The dialog has two required boxes - "Complaint" and "Details" - and the
     * complaint was written to neither, so a clinician who typed the reason the
     * patient came in and the elaboration of it lost the reason. The fold lives
     * in the seeded module now, with the rest of the logic that cannot be checked
     * from inside a component, and it keeps both boxes.
     */
    const history = foldHistory(complaintEntries);
    const presentingComplaint = history.presentingComplaint;
    const hpcVal = history.historyOfPresentingComplaint;
    const pmhVal = history.pastMedicalHistory;
    /**
     * The Surgery History tab's structured entries, serialised into the column.
     *
     * This used to read a *complaint* entry whose title contained "surgical",
     * which the Surgery History tab never writes, so every operation recorded
     * there was discarded on save. The free-text complaint entry is still
     * honoured when the tab is empty, so a clinician who types surgical history
     * into Complaint & History is not worse off than before - but the structured
     * tab wins when it has something, because it is the one that was being lost.
     */
    const surgicalVal = formatSurgeryHistory(surgeryEntries)
      || history.surgicalHistory
      || '';
    const drugVal = history.drugHistory;
    const familyVal = history.familyHistory;
    const socialVal = history.socialHistory;
    const allergyVal = history.allergyHistory || patient?.allergies?.join(', ') || '';

    const phyExam = {
      general: examMap['general'] || '',
      cardiovascular: examMap['cardiovascular'] || '',
      respiratory: examMap['respiratory'] || '',
      abdomen: examMap['abdomen'] || '',
      neurological: examMap['neurological'] || '',
      musculoskeletal: examMap['musculoskeletal'] || '',
      other: examMap['other'] || ''
    };

    db.saveConsultation({
      visitId: activeVisit.id,
      patientId: patient.id,
      physicianId: currentUser.id,
      physicianName: currentUser.name,
      presentingComplaint,
      historyOfPresentingComplaint: hpcVal,
      pastMedicalHistory: pmhVal,
      surgicalHistory: surgicalVal,
      drugHistory: drugVal,
      familyHistory: familyVal,
      socialHistory: socialVal,
      allergyHistory: allergyVal,
      physicalExamination: phyExam,
      clinicalFindings,
      assessment,
      diagnoses,
      plan,
      followUpDate,
      clinicalNotes
    }, currentUser);

    if (orderedLabTests.length > 0) {
      const testsToOrder = orderedLabTests.map(item => ({
        id: 'LTO-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        testDefinitionId: item.testDefinitionId,
        testName: item.testName,
        category: item.category,
        price: item.price,
        sampleType: item.sampleType,
        status: 'Requested' as const
      }));
      const totalLabFee = testsToOrder.reduce((sum, t) => sum + t.price, 0);
      db.createLabRequest({
        visitId: activeVisit.id,
        patientId: patient.id,
        physicianId: currentUser.id,
        physicianName: currentUser.name,
        priority: currentPriority,
        clinicalIndication: orderClinicalNotes || assessment || presentingComplaint,
        tests: testsToOrder,
        paymentStatus: 'Unpaid',
        totalPrice: totalLabFee
      }, currentUser);
      setOrderedLabTests([]);
    }
    if (rxItems.length > 0) {
      const itemsToPrescribe = rxItems.map(item => {
        const med = db.getMedicationById(item.medId)!;
        return {
          id: 'RXI-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
          medicationId: med.id,
          medicationName: med.name,
          dosage: item.dosage,
          route: item.route,
          frequency: item.frequency,
          duration: item.duration,
          quantityPrescribed: item.quantity,
          quantityDispensed: 0,
          unitPrice: med.unitPrice,
          totalPrice: med.unitPrice * item.quantity,
          instructions: item.instructions,
          dispenseStatus: 'Pending' as const
        };
      });
      const totalRxFee = itemsToPrescribe.reduce((sum, i) => sum + i.totalPrice, 0);
      db.createPrescription({
        visitId: activeVisit.id,
        patientId: patient.id,
        physicianId: currentUser.id,
        physicianName: currentUser.name,
        status: 'Pending',
        items: itemsToPrescribe,
        totalPrice: totalRxFee
      }, currentUser);
      setRxItems([]);
    }
    db.updateVisitStatus(activeVisit.id, 'In Consultation', currentUser);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
    if (onSaved) onSaved();
  };

  const totalLabPrice = orderedLabTests.reduce((sum, t) => sum + t.price, 0);
  const totalRxPrice = rxItems.reduce((sum, item) => {
    const med = db.getMedicationById(item.medId);
    return sum + (med ? med.unitPrice * item.quantity : 0);
  }, 0);

  const [activeConsultTab, setActiveConsultTab] = useState<number>(0);

  const inputCls = 'w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-emerald-500 focus:outline-none text-xs';
  const labelCls = 'block font-bold text-slate-700 dark:text-slate-200 mb-1 text-xs';

   const visitLabRequests = activeVisit ? db.getLabRequests({ visitId: activeVisit.id }) : [];
  const visitPrescriptions = activeVisit && patient ? db.getPrescriptions(patient.id, activeVisit.id) : [];

  // helper for vitals BMI display
  const bmiColor = vitals ? (vitals.bmi <18.5? 'text-blue-600' : vitals.bmi<25? 'text-emerald-600' : vitals.bmi<30? 'text-amber-600' : 'text-rose-600') : 'text-slate-500';

  // Patient list first (All / Awaiting / Consulted / Incoming). This early
  // return sits AFTER all hooks so hook order is identical on every render.
  if (!patient) {
    const filterLabel = activeSubNav === 'consultations_awaiting' ? 'Awaiting' : activeSubNav === 'consultations_consulted' ? 'Consulted' : activeSubNav === 'consultations_incoming' ? 'Incoming' : 'All Patients';
    const today = new Date().toISOString().split('T')[0];
    let displayPatients: Patient[] = [];

    if (!activeSubNav || activeSubNav === 'consultations_all' || activeSubNav === 'consultations') {
      displayPatients = patientSearch ? patientSearchResults : allPatients;
    } else if (activeSubNav === 'consultations_awaiting') {
      const ids = new Set(db.getVisits().filter(v => v.visitDate === today && ['With Doctor', 'Awaiting Physician', 'Awaiting Lab', 'Awaiting Pharmacy'].includes(v.status)).map(v => v.patientId));
      displayPatients = (patientSearch ? patientSearchResults : allPatients).filter(p => ids.has(p.id));
    } else if (activeSubNav === 'consultations_consulted') {
      const ids = new Set(db.getVisits().filter(v => v.visitDate === today && v.status === 'In Consultation').map(v => v.patientId));
      displayPatients = (patientSearch ? patientSearchResults : allPatients).filter(p => ids.has(p.id));
    } else if (activeSubNav === 'consultations_incoming') {
      const ids = new Set(db.getVisits().filter(v => v.visitDate === today && ['Awaiting Vitals', 'With Nurse'].includes(v.status)).map(v => v.patientId));
      displayPatients = (patientSearch ? patientSearchResults : allPatients).filter(p => ids.has(p.id));
    }

    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="p-3 bg-white dark:bg-dark-card border-b border-light-border dark:border-dark-border flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] font-bold text-rose-600 px-2.5 py-1.5 rounded-lg bg-rose-50 border border-rose-200 flex-shrink-0">{filterLabel} — {displayPatients.length}</span>
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={patientSearch} onChange={e => setPatientSearch(e.target.value)} placeholder="Search patients..." className="w-full pl-8 pr-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border focus:ring-2 focus:ring-rose-500 focus:outline-none" />
          </div>
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
                const latestVisit = db.getVisits(p.id)[0];
                const visitCount = db.getVisits(p.id).length;
                const hasScheduled = db.getVisits(p.id).some(v => ['Awaiting Vitals', 'With Nurse'].includes(v.status));
                // Doctors attend only patients sent by nurses; otherwise profile only.
                // Incoming view is always profile only.
                const profileOnly = activeSubNav === 'consultations_incoming' || !mayDoctorWrite(latestVisit);
                const dotCls = !latestVisit ? 'bg-slate-300'
                  : ['Treated', 'Completed', 'Discharged'].includes(latestVisit.status) ? 'bg-emerald-500'
                  : latestVisit.status === 'In Consultation' ? 'bg-blue-500 animate-pulse'
                  : ['With Doctor', 'Awaiting Physician'].includes(latestVisit.status) ? 'bg-violet-500 animate-pulse'
                  : latestVisit.status === 'With Nurse' ? 'bg-teal-500 animate-pulse'
                  : 'bg-amber-500';
                return (
                  <div key={p.id} onClick={() => { if (profileOnly) { if (onOpenProfile) onOpenProfile(p); return; } setCurrentPatientId(p.id); const vs = db.getVisits(p.id); setCurrentVisitId(vs[0]?.id || ''); if (onSelectPatient) onSelectPatient(p); }} className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border hover:border-rose-400 hover:shadow-md cursor-pointer transition-all group">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-950/40 flex items-center justify-center text-lg font-bold text-rose-600">{p.firstName[0]}{p.lastName[0]}</div>
                        <div>
                          <div className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-rose-600 transition-colors">{p.firstName} {p.lastName}</div>
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
                          className="p-1.5 rounded-lg bg-slate-100 dark:bg-dark-surface hover:bg-rose-100 dark:hover:bg-rose-950/40 text-slate-500 hover:text-rose-600 border border-light-border dark:border-dark-border transition-colors"
                        >
                          <ListChecks className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-100 dark:border-dark-border flex items-center justify-between text-[11px] text-slate-500">
                      <span>{p.sex}, {p.age}y • {p.phone}</span>
                      <span className="font-bold">{visitCount} visit(s)</span>
                    </div>
                      {latestVisit && (
                        <div className="mt-2 flex items-center space-x-1.5 flex-wrap">
                          <span className={`w-1.5 h-1.5 rounded-full ${dotCls}`} />
                          <span className="text-[10px] font-bold text-slate-500">{latestVisit.status}</span>
                          {latestVisit.status === 'Admitted' && latestVisit.ward && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">Ward: {wardName(latestVisit.ward)}</span>
                          )}
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
          const items = getPhysicianChecklist(pp);
          const doneCount = items.filter(i => i.done).length;
          const ppLatest = db.getVisits(pp.id)[0];
          const ppAttendable = activeSubNav !== 'consultations_incoming' && mayDoctorWrite(ppLatest);
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-slate-900/60" onClick={() => setProgressPatientId(null)} />
              <div className="relative bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-md border border-light-border dark:border-dark-border">
                <div className="px-5 py-4 border-b border-light-border dark:border-dark-border flex items-center justify-between">
                  <div>
                    <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center space-x-2">
                      <ListChecks className="w-4 h-4 text-rose-500" />
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
                    onClick={() => { if (!ppAttendable) { if (onOpenProfile) onOpenProfile(pp); setProgressPatientId(null); return; } setCurrentPatientId(pp.id); const vs = db.getVisits(pp.id); setCurrentVisitId(vs[0]?.id || ''); if (onSelectPatient) onSelectPatient(pp); setProgressPatientId(null); }}
                    className="px-5 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white"
                  >
                    {ppAttendable ? 'Open Patient Details' : 'Open Profile'}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col select-text overflow-hidden">
      {/* Compact context + action bar */}
      <div className="px-3 py-2 bg-white dark:bg-dark-card border-b border-light-border dark:border-dark-border flex flex-wrap items-center gap-2 text-xs flex-shrink-0">
        <div className="flex items-center space-x-1.5 font-bold text-slate-800 dark:text-slate-200">
          <Stethoscope className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" />
          <span className="text-emerald-600 dark:text-emerald-400 font-extrabold">{patient ? `${patient.firstName} ${patient.lastName}` : 'No patient'}</span>
          <span className="text-slate-400 font-mono text-[10px]">({patient?.id || '—'})</span>
        </div>
        <div className="flex items-center space-x-1 text-slate-600 dark:text-slate-300">
          <Calendar className="w-3 h-3 text-blue-500" />
          <select value={currentVisitId} onChange={e => setCurrentVisitId(e.target.value)} className="bg-transparent font-semibold focus:outline-none cursor-pointer hover:underline max-w-[220px] text-[11px]">
            {visits.length === 0 ? <option value="">No visits yet</option> : visits.map(v => <option key={v.id} value={v.id} className="bg-white dark:bg-dark-card text-slate-900 dark:text-slate-100">Visit: {v.visitDate} ({v.visitType}) - {v.status}</option>)}
          </select>
        </div>
        <span className="text-slate-500 text-[11px] hidden lg:inline">Age: {patient?.age || '—'}y • BP: {vitals ? `${vitals.systolicBp}/${vitals.diastolicBp}` : 'N/A'} • Temp: {vitals ? `${vitals.temperature}°C` : 'N/A'}</span>
        <div className="flex items-center space-x-1.5 ml-auto">
          <button type="button" onClick={() => { setPatientSearch(''); setShowPatientSearch(true); }} className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 hover:bg-rose-100">
            <User className="w-3 h-3" /><span>Patients</span>
          </button>
          {activeVisit && mayDoctorWrite(activeVisit) && activeVisit.status !== 'Admitted' && (
            <button type="button" onClick={() => setShowAdmit(true)} className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-600 hover:bg-amber-700 text-white">
              <Layers className="w-3 h-3" /><span>Admit</span>
            </button>
          )}
          {activeVisit && mayDoctorWrite(activeVisit) && activeVisit.status !== 'Admitted' && (
            <button type="button" onClick={() => { if (confirm('Mark this patient as Treated? The visit will be closed.')) db.updateVisitStatus(activeVisit.id, 'Treated', currentUser); }} className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white">
              <CheckCircle2 className="w-3 h-3" /><span>Treated</span>
            </button>
          )}
          {activeVisit && activeVisit.status === 'Admitted' && (
            <button type="button" onClick={() => { if (confirm('Discharge this admitted patient?')) db.updateVisitStatus(activeVisit.id, 'Discharged', currentUser); }} className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-rose-600 hover:bg-rose-700 text-white">
              <CheckCircle2 className="w-3 h-3" /><span>Discharge</span>
            </button>
          )}
          {savedSuccess && !saveBlocked && <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center space-x-1"><CheckCircle2 className="w-3 h-3" /><span>Saved!</span></span>}
          {onToggleWideMode && (
            <button type="button" onClick={onToggleWideMode} title={isWideMode ? "Restore normal view" : "Expand to broad view"} className="p-1.5 rounded-lg border border-light-border dark:border-dark-border hover:bg-slate-100 text-slate-500">
              {isWideMode ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          )}
          <button
            type="button"
            onClick={handleSaveConsultation}
            disabled={!canWrite}
            title={canWrite ? 'Save this consultation' : (gateReason ?? 'Read only')}
            className={`flex items-center space-x-1 px-3.5 py-1.5 rounded-lg text-[11px] font-bold shadow-sm ${canWrite ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-slate-200 dark:bg-dark-surface text-slate-400 dark:text-slate-500 cursor-not-allowed shadow-none'}`}
          >
            <Save className="w-3.5 h-3.5" /><span>Save</span>
          </button>
        </div>
      </div>

      {/*
        The gate, stated where the doctor is looking.

        Without this the Save button is simply greyed out, and a greyed-out button
        on a screen full of empty boxes reads as "the app is broken" rather than
        "this patient is not yours yet". Saying which of the two reasons applies
        is the difference between a doctor waiting for nursing and a doctor
        filing a bug report.
      */}
      {!canWrite && (
        <div className="flex items-start gap-2 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 text-[11px] text-amber-900 dark:text-amber-200 flex-shrink-0">
          <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
          <div>
            <span className="font-extrabold">Read only. </span>
            <span>{gateReason}</span>
          </div>
        </div>
      )}
      {saveBlocked && (
        <div className="flex items-start gap-2 px-4 py-2.5 bg-rose-50 dark:bg-rose-950/30 border-b border-rose-200 dark:border-rose-800 text-[11px] text-rose-900 dark:text-rose-200 flex-shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
          <div>
            <span className="font-extrabold">{saveBlockedKind === 'refused' ? 'Read only. ' : 'Not saved. '}</span>
            <span>{saveBlocked}</span>
          </div>
        </div>
      )}

      {aiSuggestions.length > 0 && (
        <div className="p-3 bg-fuchsia-50 dark:bg-fuchsia-950/40 border-b border-fuchsia-200 dark:border-fuchsia-900 animate-in fade-in">
          <div className="flex items-center justify-between mb-1.5"><div className="flex items-center space-x-1.5 text-xs font-bold text-fuchsia-700 dark:text-fuchsia-300"><Sparkles className="w-4 h-4" /><span>AI Clinical Autocomplete Suggestions:</span></div><button onClick={() => setAiSuggestions([])} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">Dismiss</button></div>
          <div className="flex flex-wrap gap-2">{aiSuggestions.map((sug,i)=><button key={i} type="button" onClick={()=>applyAiSuggestion(sug)} className="text-left px-3 py-1.5 rounded-xl text-xs bg-white dark:bg-dark-card hover:bg-fuchsia-100 dark:hover:bg-fuchsia-900/60 border border-fuchsia-200 dark:border-fuchsia-800 text-slate-800 dark:text-slate-200 shadow-sm transition-all">+ {sug}</button>)}</div>
        </div>
      )}

      {/* --- CONSULTATION TABS - fixed immediately after header --- */}
      <div className="flex-shrink-0 bg-white dark:bg-dark-card border-b border-light-border dark:border-dark-border px-4 pt-2 sticky top-0 z-20 shadow-sm">
        <div className="flex items-center space-x-1 overflow-x-auto pb-0 scrollbar-thin">
          {[
            { id: 0, label: "Patient's Info", activeColor: 'border-teal-500 text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/40' },
            { id: 1, label: 'Complaint & History', activeColor: 'border-emerald-500 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40' },
            { id: 2, label: 'Physical Examination', activeColor: 'border-blue-500 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40' },
            { id: 3, label: 'Surgery History', activeColor: 'border-amber-500 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40' },
            { id: 4, label: 'Diagnosis (ICD-10)', activeColor: 'border-rose-500 text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40' },
            { id: 5, label: 'Lab Orders', activeColor: 'border-amber-500 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40' },
            { id: 6, label: 'Prescriptions', activeColor: 'border-purple-500 text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/40' },
            { id: 7, label: 'Management Plan', activeColor: 'border-teal-600 text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/40' },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveConsultTab(tab.id)} className={`flex-shrink-0 px-4 py-2.5 text-[11px] font-bold rounded-t-xl border-b-2 transition-all duration-150 whitespace-nowrap ${activeConsultTab === tab.id ? tab.activeColor : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-dark-surface'}`}>
              {tab.id === 0 ? tab.label : `${tab.id}. ${tab.label}`}
            </button>
          ))}
        </div>
      </div>

      {/* --- MAIN WORKSPACE --- */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Detail pane */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50 dark:bg-dark-bg min-w-0">
        {!patient ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <Users className="w-10 h-10 text-slate-300 mb-2" />
            <p className="text-sm font-bold text-slate-500">Select a patient from the queue to view info, results and prescriptions.</p>
            <p className="text-[11px] text-slate-400 mt-1">Use All / Awaiting / Consulted / Incoming filters, sorted by day. Alerts jump straight to the patient.</p>
          </div>
        ) : (
        <div className="space-y-6">
        {/* 0 - PATIENTS INFO BEAUTIFUL DASHBOARD */}
        {activeConsultTab === 0 && (
          <div className="space-y-4 animate-in fade-in">
            {/* Hero Card */}
            <div className="rounded-2xl overflow-hidden border border-light-border dark:border-dark-border shadow-sm bg-white dark:bg-dark-card">
              <div className="bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-600 p-5 text-white relative overflow-hidden">
                <div className="absolute -right-10 -top-10 w-40 h-40 bg-white/10 rounded-full blur-2xl" />
                <div className="absolute -left-6 -bottom-6 w-32 h-32 bg-white/10 rounded-full blur-xl" />
                <div className="relative flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center space-x-4">
                    <div className="w-16 h-16 rounded-2xl bg-white text-emerald-700 flex items-center justify-center text-xl font-black shadow-lg">
                      {patient.firstName[0]}{patient.lastName[0]}
                    </div>
                    <div>
                      <h3 className="text-lg font-extrabold leading-none">{patient.firstName} {patient.middleName ? patient.middleName + ' ' : ''}{patient.lastName}</h3>
                      <p className="text-xs font-mono bg-white/20 inline-block px-2 py-0.5 rounded-full mt-1">{patient.id} • {patient.age} yrs • {patient.sex}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]">
                        <span className="bg-white/20 px-2 py-1 rounded-full flex items-center space-x-1"><Calendar className="w-3 h-3" /><span>Visit: {activeVisit?.visitDate} ({activeVisit?.visitType})</span></span>
                        <span className={`px-2 py-1 rounded-full font-bold ${activeVisit?.status==='In Consultation' ? 'bg-amber-400 text-amber-900' : 'bg-white/90 text-emerald-700'}`}>{activeVisit?.status}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs opacity-80">Attending Physician</div>
                    {/* Falls back to the signed-in clinician, who is who writes
                        `physicianName` on save. This used to fall back to a
                        hardcoded invented doctor, which put a fabricated name in
                        the Attending Physician box of a real patient's record
                        every time the consultation had not been saved yet. */}
                    <div className="font-bold text-sm">{existingConsultation?.physicianName || currentUser.name}</div>
                    <div className="text-xs opacity-80 mt-1">Registered: {new Date(patient.registeredAt).toLocaleDateString()}</div>
                  </div>
                </div>
              </div>
              {/* quick stats grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-slate-50 dark:bg-dark-surface/40">
                <div className="bg-white dark:bg-dark-card rounded-xl p-3 border border-light-border dark:border-dark-border flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 flex items-center justify-center"><Droplet className="w-4 h-4" /></div>
                  <div><div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Blood Group</div><div className="text-sm font-extrabold text-slate-900 dark:text-white">{patient.bloodGroup || 'O Positive'}</div></div>
                </div>
                <div className="bg-white dark:bg-dark-card rounded-xl p-3 border border-light-border dark:border-dark-border flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-950/40 text-purple-600 flex items-center justify-center"><Layers className="w-4 h-4" /></div>
                  <div><div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Genotype</div><div className="text-sm font-extrabold text-slate-900 dark:text-white">{patient.genotype || 'AA'}</div></div>
                </div>
                <div className="bg-white dark:bg-dark-card rounded-xl p-3 border border-light-border dark:border-dark-border flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center"><Weight className="w-4 h-4" /></div>
                  <div><div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">BMI</div><div className={`text-sm font-extrabold ${bmiColor}`}>{vitals ? `${vitals.bmi} (${vitals.bmiCategory})` : '—'}</div></div>
                </div>
                <div className="bg-white dark:bg-dark-card rounded-xl p-3 border border-light-border dark:border-dark-border flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600 flex items-center justify-center"><Phone className="w-4 h-4" /></div>
                  <div><div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Phone</div><div className="text-xs font-bold text-slate-900 dark:text-white truncate">{patient.phone}</div></div>
                </div>
              </div>
            </div>

            {/* Details grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 space-y-4">
                <div className="bg-white dark:bg-dark-card rounded-2xl border border-light-border dark:border-dark-border p-4 shadow-sm">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200 flex items-center space-x-2 border-b border-light-border dark:border-dark-border pb-2 mb-3"><UserCheck className="w-4 h-4 text-emerald-500" /><span>Biodata & Contact</span></h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="space-y-1"><div className="text-[10px] font-bold text-slate-400 uppercase">Full Name</div><div className="font-bold text-slate-900 dark:text-white">{patient.firstName} {patient.middleName} {patient.lastName}</div></div>
                    <div className="space-y-1"><div className="text-[10px] font-bold text-slate-400 uppercase">Date of Birth / Age</div><div className="font-bold text-slate-900 dark:text-white">{patient.dob} • {patient.age} years</div></div>
                    <div className="space-y-1"><div className="text-[10px] font-bold text-slate-400 uppercase">Sex</div><div className="font-bold text-slate-900 dark:text-white">{patient.sex}</div></div>
                    <div className="space-y-1"><div className="text-[10px] font-bold text-slate-400 uppercase">Occupation</div><div className="font-semibold text-slate-700 dark:text-slate-300">{patient.occupation || '—'}</div></div>
                    <div className="space-y-1 sm:col-span-2"><div className="text-[10px] font-bold text-slate-400 uppercase flex items-center space-x-1"><MapPin className="w-3 h-3" /><span>Address</span></div><div className="font-medium text-slate-700 dark:text-slate-300">{patient.address}</div></div>
                    <div className="space-y-1"><div className="text-[10px] font-bold text-slate-400 uppercase">Next of Kin</div><div className="font-medium text-slate-700 dark:text-slate-300">{patient.nextOfKin}</div></div>
                    <div className="space-y-1"><div className="text-[10px] font-bold text-slate-400 uppercase">Emergency Contact</div><div className="font-bold text-emerald-600">{patient.emergencyContact}</div></div>
                  </div>
                </div>

                {/* Allergies & Alerts */}
                <div className="bg-white dark:bg-dark-card rounded-2xl border border-light-border dark:border-dark-border p-4 shadow-sm">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-rose-700 dark:text-rose-300 flex items-center space-x-2 mb-3"><ShieldAlert className="w-4 h-4" /><span>Allergies & Clinical Alerts</span></h4>
                  <div className="flex flex-wrap gap-2">
                    {patient.allergies.length>0 ? patient.allergies.map(a=> <span key={a} className="px-3 py-1.5 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 text-xs font-bold border border-rose-200 dark:border-rose-800">{a}</span>) : <span className="text-xs text-slate-400">No known allergies</span>}
                  </div>
                  {patient.alerts.length>0 && <div className="mt-3 flex flex-wrap gap-2">{patient.alerts.map(al=> <span key={al} className="px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-[11px] font-bold border border-amber-200">{al}</span>)}</div>}
                  {vitals?.alerts && vitals.alerts.length>0 && <div className="mt-2 p-2 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-xs font-bold text-rose-700 dark:text-rose-300 flex items-center space-x-1"><AlertTriangle className="w-3.5 h-3.5" /><span>{vitals.alerts.join(', ')}</span></div>}
                </div>
              </div>

              {/* Vitals dashboard */}
              <div className="space-y-4">
                <div className="bg-white dark:bg-dark-card rounded-2xl border border-light-border dark:border-dark-border p-4 shadow-sm">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-teal-700 dark:text-teal-300 flex items-center space-x-2 border-b border-light-border dark:border-dark-border pb-2 mb-3"><HeartPulse className="w-4 h-4" /><span>Triaged Vitals</span></h4>
                  {vitals ? (
                    <>
                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="p-3 rounded-xl bg-gradient-to-br from-rose-500 to-orange-500 text-white">
                          <div className="flex items-center space-x-1.5 text-[10px] font-bold uppercase opacity-90"><Thermometer className="w-3 h-3" /><span>Temp</span></div>
                          <div className="text-lg font-black">{vitals.temperature}°C</div>
                          <div className="text-[10px] opacity-80">{vitals.temperature>=38? 'Febrile':'Afebrile'}</div>
                        </div>
                        <div className="p-3 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
                          <div className="flex items-center space-x-1.5 text-[10px] font-bold uppercase opacity-90"><Heart className="w-3 h-3" /><span>Pulse</span></div>
                          <div className="text-lg font-black">{vitals.pulse} bpm</div>
                          <div className="text-[10px] opacity-80">Resp: {vitals.respiratoryRate}/min</div>
                        </div>
                        <div className="p-3 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
                          <div className="flex items-center space-x-1.5 text-[10px] font-bold uppercase opacity-90"><Activity className="w-3 h-3" /><span>Blood Pressure</span></div>
                          <div className="text-lg font-black">{vitals.systolicBp}/{vitals.diastolicBp}</div>
                          <div className="text-[10px] opacity-80">mmHg</div>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-900 dark:bg-dark-surface text-white">
                          <div className="flex items-center space-x-1.5 text-[10px] font-bold uppercase opacity-80"><Droplet className="w-3 h-3 text-cyan-400" /><span>SpO2 • BMI</span></div>
                          <div className="text-lg font-black">{vitals.spo2}% <span className="text-xs font-bold opacity-70">• {vitals.bmi}</span></div>
                          <div className="text-[10px] opacity-70">{vitals.bmiCategory}</div>
                        </div>
                      </div>
                      <div className="mt-3 p-2.5 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-xs">
                        <div className="flex justify-between"><span className="text-slate-500 font-semibold">Weight</span><span className="font-bold text-slate-900 dark:text-white">{vitals.weight} kg</span></div>
                        <div className="flex justify-between"><span className="text-slate-500 font-semibold">Height</span><span className="font-bold text-slate-900 dark:text-white">{vitals.height} m</span></div>
                        <div className="flex justify-between"><span className="text-slate-500 font-semibold">Pain Score</span><span className="font-bold text-slate-900 dark:text-white">{vitals.painScore ?? 0}/10</span></div>
                        <div className="flex justify-between"><span className="text-slate-500 font-semibold">Nurse</span><span className="font-bold text-emerald-600 text-[11px]">{vitals.nurseName}</span></div>
                      </div>
                      {vitals.nursingNotes && <div className="mt-2 text-[11px] text-slate-600 dark:text-slate-400 bg-amber-50 dark:bg-amber-950/20 p-2 rounded-xl border border-amber-100 dark:border-amber-900"><span className="font-bold">Nursing Note:</span> {vitals.nursingNotes}</div>}
                    </>
                  ) : (
                    <div className="p-6 text-center text-slate-400 text-xs"><Clock className="w-6 h-6 mx-auto mb-1" />No vitals yet for this visit.</div>
                  )}
                </div>

                <div className="bg-gradient-to-br from-slate-900 to-slate-800 dark:from-dark-card dark:to-dark-surface rounded-2xl p-4 text-white border border-slate-700">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider opacity-80 mb-2 flex items-center space-x-1"><FileText className="w-3.5 h-3.5" /><span>Visit Summary</span></h4>
                  <div className="text-xs space-y-1">
                    <div className="flex justify-between"><span className="opacity-60">Reason</span><span className="font-semibold text-right max-w-[150px] truncate">{activeVisit?.reasonForVisit || '—'}</span></div>
                    <div className="flex justify-between"><span className="opacity-60">Type</span><span className="font-semibold">{activeVisit?.visitType}</span></div>
                    <div className="flex justify-between"><span className="opacity-60">Date</span><span className="font-mono">{activeVisit?.visitDate} {activeVisit?.visitTime}</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeConsultTab === 1 && (
          <div className="p-5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center space-x-2">
                <FileText className="w-4 h-4 text-emerald-600" /><span>1. Complaint & Clinical History</span>
                <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200">{complaintEntries.length} item(s)</span>
              </h3>
              <div className="flex items-center space-x-2">
                <button type="button" onClick={() => handleAiAutocomplete('complaint')} className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-fuchsia-50 dark:bg-fuchsia-950/50 text-fuchsia-700 dark:text-fuchsia-300 border border-fuchsia-200 dark:border-fuchsia-800 hover:bg-fuchsia-100"><Sparkles className="w-3 h-3" /><span>AI Suggest</span></button>
                <button type="button" onClick={openComplaintAdd} className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"><Plus className="w-3.5 h-3.5" /><span>Add Entry</span></button>
              </div>
            </div>
            {complaintEntries.length===0 ? (
              <div className="p-8 rounded-xl border-2 border-dashed border-light-border dark:border-dark-border text-center">
                <ClipboardList className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                <p className="text-xs font-bold text-slate-500">No complaint/history entries yet.</p>
                <p className="text-[11px] text-slate-400 mt-1">Click “Add Entry” to document the patient’s story.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {complaintEntries.map(entry=>(
                  <div key={entry.id} className="rounded-xl border border-light-border dark:border-dark-border bg-slate-50 dark:bg-dark-surface/50 overflow-hidden group hover:shadow-sm transition-all">
                    <div className="px-4 py-2.5 flex items-center justify-between bg-white dark:bg-dark-card border-b border-light-border dark:border-dark-border">
                      <h4 className="text-xs font-extrabold text-slate-800 dark:text-slate-100 flex items-center space-x-2"><Bookmark className="w-3.5 h-3.5 text-emerald-500" /><span>{entry.title}</span></h4>
                      <div className="flex items-center space-x-1">
                        <button type="button" onClick={()=> openComplaintEdit(entry)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-surface text-slate-500 hover:text-emerald-600"><Edit3 className="w-3.5 h-3.5" /></button>
                        <button type="button" onClick={()=> setComplaintEntries(prev=> prev.filter(x=>x.id!==entry.id))} className="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-400 hover:text-rose-600"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                    {/* entryText, not entry.body: the dialog has a Complaint box and
                        a Details box, and showing only Details hid half of what the
                        doctor wrote - and, before the fold was fixed, hid what
                        actually got saved. */}
                    <div className="px-4 py-3 text-xs leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{entryText(entry)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeConsultTab === 2 && (
          <div className="p-5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center space-x-2">
                <HeartPulse className="w-4 h-4 text-blue-600" /><span>2. Structured Physical Examination</span>
                <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200">{examEntries.length} finding(s)</span>
              </h3>
              <div className="flex items-center space-x-2">
                <button type="button" onClick={() => handleAiAutocomplete('exam')} className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-fuchsia-50 dark:bg-fuchsia-950/50 text-fuchsia-700 dark:text-fuchsia-300 border border-fuchsia-200 dark:border-fuchsia-800 hover:bg-fuchsia-100"><Sparkles className="w-3 h-3" /><span>AI Template</span></button>
                <button type="button" onClick={openExamAdd} className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"><Plus className="w-3.5 h-3.5" /><span>Add Finding</span></button>
              </div>
            </div>
            {examEntries.length===0 ? (
              <div className="p-8 rounded-xl border-2 border-dashed border-light-border dark:border-dark-border text-center">
                <Stethoscope className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                <p className="text-xs font-bold text-slate-500">No examination findings documented.</p>
                <p className="text-[11px] text-slate-400 mt-1">Add system-wise findings with the button above.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {examEntries.map(e=>(
                  <div key={e.id} className="rounded-xl border border-light-border dark:border-dark-border bg-slate-50 dark:bg-dark-surface/40 overflow-hidden flex flex-col">
                    <div className="px-3 py-2 flex items-center justify-between bg-white dark:bg-dark-card border-b border-light-border dark:border-dark-border">
                      <span className="text-xs font-extrabold text-blue-700 dark:text-blue-300">{e.title}</span>
                      <div className="flex items-center space-x-1">
                        <button type="button" onClick={()=> openExamEdit(e)} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-dark-surface text-slate-500"><Edit3 className="w-3 h-3" /></button>
                        <button type="button" onClick={()=> setExamEntries(prev=> prev.filter(x=>x.id!==e.id))} className="p-1 rounded hover:bg-rose-50 text-rose-500"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                    <div className="p-3 text-xs leading-relaxed text-slate-700 dark:text-slate-300 flex-1 whitespace-pre-wrap">{e.body}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeConsultTab === 3 && (
          <div className="p-5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center space-x-2">
                <FilePlus2 className="w-4 h-4 text-amber-600" /><span>3. Surgery History</span>
                <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200">{surgeryEntries.length} surgery(ies)</span>
              </h3>
              <button type="button" onClick={openSurgeryAdd} className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"><Plus className="w-3.5 h-3.5" /><span>Add Surgery</span></button>
            </div>
            {surgeryEntries.length===0 ? (
              <div className="p-8 rounded-xl border-2 border-dashed border-light-border dark:border-dark-border text-center">
                <FilePlus2 className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                <p className="text-xs font-bold text-slate-500">No surgery history recorded.</p>
                <p className="text-[11px] text-slate-400 mt-1">Click "Add Surgery" to record past surgical procedures.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {surgeryEntries.map(s=>(
                  <div key={s.id} className="rounded-xl border border-light-border dark:border-dark-border bg-slate-50 dark:bg-dark-surface/40 overflow-hidden">
                    <div className="px-4 py-2.5 flex items-center justify-between bg-white dark:bg-dark-card border-b border-light-border dark:border-dark-border">
                      <div className="flex items-center space-x-3">
                        <span className="text-xs font-extrabold text-amber-700 dark:text-amber-300">{s.surgeryType}</span>
                        {s.date && <span className="text-[10px] font-bold text-slate-500 flex items-center space-x-1"><Timer className="w-3 h-3" /><span>{s.date}</span></span>}
                        {s.hospital && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-dark-surface text-slate-600 dark:text-slate-300 font-bold">{s.hospital}</span>}
                      </div>
                      <div className="flex items-center space-x-1">
                        <button type="button" onClick={()=> openSurgeryEdit(s)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-surface text-slate-500"><Edit3 className="w-3.5 h-3.5" /></button>
                        <button type="button" onClick={()=> setSurgeryEntries(prev=> prev.filter(x=>x.id!==s.id))} className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                    {s.notes && <div className="p-3 text-xs leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{s.notes}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeConsultTab === 4 && (
          <div className="p-5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center space-x-2"><FilePlus2 className="w-4 h-4 text-rose-600" /><span>3. Clinical Impression & ICD-10 Diagnosis</span></h3>
              <div className="flex items-center space-x-2">
                <button type="button" onClick={() => handleAiAutocomplete('diagnosis')} className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-fuchsia-50 dark:bg-fuchsia-950/50 text-fuchsia-700 dark:text-fuchsia-300 border border-fuchsia-200 dark:border-fuchsia-800 hover:bg-fuchsia-100"><Sparkles className="w-3 h-3" /><span>AI ICD-10 Match</span></button>
                <button type="button" onClick={openDiagAdd} className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"><Plus className="w-3.5 h-3.5" /><span>Add Impression / Diagnosis</span></button>
              </div>
            </div>
            {diagnosisEntries.length===0 ? (
              <div className="p-6 text-center text-slate-400 text-xs border-2 border-dashed rounded-xl">No clinical impression documented yet.</div>
            ) : (
              <div className="space-y-2.5">
                {diagnosisEntries.map(d=>(
                  <div key={d.id} className={`p-3 rounded-xl border flex items-start justify-between gap-3 ${d.isCoded? 'bg-blue-50/60 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900':'bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900'}`}>
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-xs font-extrabold ${d.isCoded? 'text-blue-800 dark:text-blue-200':'text-amber-800 dark:text-amber-200'}`}>{d.title}</span>
                        {d.isCoded && <><span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-dark-card border font-bold text-blue-600">{d.code}</span><span className={`text-[9px] px-1.5 py-0.5 rounded font-black uppercase ${d.type==='Primary'?'bg-blue-600 text-white':'bg-slate-700 text-white'}`}>{d.type}</span></>}
                        {!d.isCoded && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-bold uppercase">Impression</span>}
                      </div>
                      {d.body !== d.title && <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 whitespace-pre-wrap">{d.body}</p>}
                    </div>
                    <div className="flex items-center space-x-1 flex-shrink-0">
                      <button type="button" onClick={()=> openDiagEdit(d)} className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-dark-surface text-slate-500"><Edit3 className="w-3.5 h-3.5" /></button>
                      <button type="button" onClick={()=> setDiagnosisEntries(prev=> prev.filter(x=>x.id!==d.id))} className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeConsultTab === 5 && (
          <div className="p-5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-light-border dark:border-dark-border pb-3">
              <div>
                <div className="flex items-center space-x-2"><FlaskConical className="w-5 h-5 text-amber-500" /><h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-200">5. Laboratory Orders</h3></div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Order investigations via the dialog – choose department, tests and urgency</p>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300 hidden sm:inline">Priority:</span>
                <span className="text-xs font-black px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200">{currentPriority}</span>
                <button type="button" onClick={openLabDlg} className="flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"><Plus className="w-4 h-4" /><span>Add Lab Order</span></button>
              </div>
            </div>
            {/* ordered list */}
            <div className="space-y-2">
              <div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-700 dark:text-slate-300">Ordered Investigations List ({orderedLabTests.length}):</span>{orderedLabTests.length>0 && <span className="text-xs font-extrabold text-emerald-700 dark:text-emerald-400">Total Lab Fee: {settings.currency}{totalLabPrice.toLocaleString()}</span>}</div>
              {orderedLabTests.length===0 ? (
                <div className="p-6 rounded-xl border-2 border-dashed border-light-border dark:border-dark-border text-center text-xs text-slate-400">
                  <Beaker className="w-6 h-6 mx-auto mb-1 opacity-50" />No laboratory tests added yet. Click "Add Lab Order" to select investigations.
                </div>
              ) : (
                <div className="space-y-2">
                  {orderedLabTests.map(item=>{
                    const deptMeta = DEPARTMENTS.find(d=> d.id===item.category);
                    return (
                      <div key={item.id} className="p-3 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border flex flex-wrap items-center justify-between gap-3 text-xs">
                        <div className="flex items-center space-x-3">
                          <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${deptMeta?.badgeBg} ${deptMeta?.badgeText}`}>{deptMeta?.shortName||item.category}</span>
                          <div><span className="font-extrabold text-slate-900 dark:text-white">{item.testName}</span><span className="text-[10px] text-slate-400 ml-2">Sample: {item.sampleType}</span></div>
                        </div>
                        <div className="flex items-center space-x-3">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-200 dark:bg-dark-card text-slate-700 dark:text-slate-300">{item.priority}</span>
                          <span className="font-extrabold text-emerald-700 dark:text-emerald-400 text-xs">{settings.currency}{item.price.toLocaleString()}</span>
                          <button type="button" onClick={()=> setOrderedLabTests(prev=> prev.filter(t=>t.id!==item.id))} className="text-rose-500 hover:text-rose-700 p-1 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {orderedLabTests.length>0 && orderClinicalNotes && <div className="text-[11px] text-slate-500 bg-slate-50 dark:bg-dark-surface p-2 rounded-xl border"><span className="font-bold">Clinical indication:</span> {orderClinicalNotes}</div>}
            </div>
            {/* Lab results for this visit */}
            <div className="space-y-2 pt-2 border-t border-light-border dark:border-dark-border">
              <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200">Results for this visit ({visitLabRequests.length} request(s)):</span>
              {visitLabRequests.length === 0 ? (
                <div className="text-[11px] text-slate-400">No lab requests on record for this visit yet — new orders appear here after saving.</div>
              ) : (
                <div className="space-y-2">
                  {visitLabRequests.flatMap(r => r.tests).map(t => (
                    <div key={t.id} className="p-3 rounded-xl border bg-white dark:bg-dark-card flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div>
                        <div className="font-bold">{t.testName}</div>
                        <div className="text-[10px] text-slate-500">{t.category} • Sample: {t.sampleType}</div>
                        {t.results && t.results.length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {t.results.map((r, i) => (
                              <div key={i} className="text-[11px]"><span className="font-semibold">{r.parameterName}:</span> <span className="font-bold">{r.value} {r.unit}</span> <span className={`text-[9px] font-bold px-1 rounded ${r.flag === 'Normal' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{r.flag}</span></div>
                            ))}
                          </div>
                        )}
                        {t.comments && <div className="text-[10px] text-slate-500 italic mt-1">{t.comments}</div>}
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${['Released', 'Verified'].includes(t.status) ? 'bg-emerald-100 text-emerald-700 border border-emerald-300' : 'bg-amber-100 text-amber-700'}`}>{t.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeConsultTab === 6 && (
          <div className="p-5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-light-border dark:border-dark-border pb-3">
              <div>
                <div className="flex items-center space-x-2"><Pill className="w-5 h-5 text-purple-500" /><h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-200">6. Direct Pharmacy Prescriptions & Therapeutics</h3></div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Prescribe medications via dialog – you can add multiple at once</p>
              </div>
              <div className="flex items-center space-x-3">
                {rxItems.length>0 && <span className="text-xs font-extrabold text-purple-700 dark:text-purple-400">Total Rx: {settings.currency}{totalRxPrice.toLocaleString()}</span>}
                <button type="button" onClick={openRxDlg} className="flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"><Plus className="w-4 h-4" /><span>Add Prescription</span></button>
              </div>
            </div>
            {rxItems.length===0 ? (
              <div className="p-6 rounded-xl border-2 border-dashed border-light-border dark:border-dark-border text-center text-xs text-slate-400">
                <Package className="w-6 h-6 mx-auto mb-1 opacity-50" />No medications prescribed yet. Click "Add Prescription" to issue.
              </div>
            ) : (
              <div className="space-y-3">
                {rxItems.map((item,idx)=>{
                  const med=db.getMedicationById(item.medId);
                  return (
                    <div key={idx} className="p-4 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-xs">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-extrabold text-purple-700 dark:text-purple-300 flex items-center space-x-2"><span className="w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center text-[10px] font-black">{idx+1}</span><span>{med?.name}</span><span className="text-[10px] font-normal text-slate-500">({med?.strength}) • {settings.currency}{med?.unitPrice}</span></span>
                        <button type="button" onClick={()=> setRxItems(prev=> prev.filter((_,i)=>i!==idx))} className="text-rose-500 hover:text-rose-700 flex items-center space-x-1"><Trash2 className="w-3.5 h-3.5" /><span>Remove</span></button>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                        <div className="bg-white dark:bg-dark-card rounded-lg p-2 border"><div className="text-[9px] font-bold text-slate-400 uppercase">Dosage</div><div className="font-bold">{item.dosage} • {item.route}</div></div>
                        <div className="bg-white dark:bg-dark-card rounded-lg p-2 border"><div className="text-[9px] font-bold text-slate-400 uppercase">Frequency</div><div className="font-bold">{item.frequency}</div></div>
                        <div className="bg-white dark:bg-dark-card rounded-lg p-2 border"><div className="text-[9px] font-bold text-slate-400 uppercase">Duration / Qty</div><div className="font-bold">{item.duration} • {item.quantity} units</div></div>
                        <div className="bg-white dark:bg-dark-card rounded-lg p-2 border"><div className="text-[9px] font-bold text-slate-400 uppercase">Instructions</div><div className="font-medium">{item.instructions}</div></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Pharmacy dispense status for this visit — light green when dispensed */}
            <div className="space-y-2 pt-2 border-t border-light-border dark:border-dark-border">
              <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200">Pharmacy status for this visit ({visitPrescriptions.length} prescription(s)):</span>
              {visitPrescriptions.length === 0 ? (
                <div className="text-[11px] text-slate-400">No prescriptions on record for this visit yet.</div>
              ) : (
                <div className="space-y-2">
                  {visitPrescriptions.flatMap(r => r.items).map(it => (
                    <div key={it.id} className={`p-3 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-2 ${it.dispenseStatus === 'Dispensed' ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300' : 'bg-white dark:bg-dark-card'}`}>
                      <div>
                        <div className="font-bold">{it.medicationName} <span className="font-normal text-slate-500">({it.dosage} • {it.frequency} • {it.duration})</span></div>
                        <div className="text-[10px] text-slate-500">Qty {it.quantityDispensed}/{it.quantityPrescribed} • {it.instructions}</div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${it.dispenseStatus === 'Dispensed' ? 'bg-emerald-200 text-emerald-800' : it.dispenseStatus === 'Partially Dispensed' ? 'bg-amber-100 text-amber-700' : it.dispenseStatus === 'Out of Stock' ? 'bg-rose-100 text-rose-700' : 'bg-slate-200 text-slate-600'}`}>{it.dispenseStatus}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeConsultTab === 7 && (
          <div className="p-5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center space-x-2"><ClipboardList className="w-4 h-4 text-teal-600" /><span>7. Clinical Management Plan & Follow-up</span>
                <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border border-teal-200">{managementEntries.length} plan(s)</span>
              </h3>
              <div className="flex items-center space-x-2">
                <button type="button" onClick={() => handleAiAutocomplete('plan')} className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-fuchsia-50 dark:bg-fuchsia-950/50 text-fuchsia-700 dark:text-fuchsia-300 border border-fuchsia-200 dark:border-fuchsia-800 hover:bg-fuchsia-100"><Sparkles className="w-3 h-3" /><span>AI Plan</span></button>
                <button type="button" onClick={openMgmtAdd} className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"><Plus className="w-3.5 h-3.5" /><span>Add Plan Item</span></button>
              </div>
            </div>
            {managementEntries.length===0 ? (
              <div className="p-8 rounded-xl border-2 border-dashed border-light-border dark:border-dark-border text-center">
                <Bed className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                <p className="text-xs font-bold text-slate-500">No management plan yet.</p>
                <p className="text-[11px] text-slate-400 mt-1">Click “Add Plan Item” to outline treatment, advice and follow-up.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {managementEntries.map(m=>(
                  <div key={m.id} className="rounded-xl border border-light-border dark:border-dark-border bg-slate-50 dark:bg-dark-surface/40 overflow-hidden">
                    <div className="px-4 py-2.5 flex items-center justify-between bg-white dark:bg-dark-card border-b border-light-border dark:border-dark-border">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-extrabold text-teal-700 dark:text-teal-300">{m.title}</span>
                        {m.category && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 font-bold border border-teal-200">{m.category}</span>}
                        {m.priority && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold">{m.priority}</span>}
                      </div>
                      <div className="flex items-center space-x-1">
                        {m.date && <span className="text-[10px] font-bold text-slate-500 flex items-center space-x-1"><Timer className="w-3 h-3" /><span>{m.date}</span></span>}
                        <button type="button" onClick={()=> openMgmtEdit(m)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-surface text-slate-500"><Edit3 className="w-3.5 h-3.5" /></button>
                        <button type="button" onClick={()=> setManagementEntries(prev=> prev.filter(x=>x.id!==m.id))} className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                    <div className="p-3 text-xs leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{m.body}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
            )}
            {/* Next Appointment - Only Doctor can create */}
            <div className="pt-4 border-t border-light-border dark:border-dark-border">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center space-x-2">
                  <Calendar className="w-4 h-4 text-emerald-500" />
                  <span>Next Appointment (Doctor Only)</span>
                </h4>
                {!showNextAppt && (
                  <button type="button" onClick={()=> setShowNextAppt(true)} className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm">
                    <Calendar className="w-3.5 h-3.5" /><span>Schedule Follow-up</span>
                  </button>
                )}
              </div>
              {showNextAppt ? (
                <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={labelCls}>Appointment Date*</label><input type="date" value={nextApptDate} onChange={e=> setNextApptDate(e.target.value)} className={inputCls} /></div>
                    <div><label className={labelCls}>Reason / Instructions</label><input value={nextApptReason} onChange={e=> setNextApptReason(e.target.value)} placeholder="e.g. Review results, follow-up..." className={inputCls} /></div>
                  </div>
                  <div className="flex justify-end space-x-2">
                    <button type="button" onClick={()=> setShowNextAppt(false)} className="px-3 py-1.5 rounded-lg text-xs font-bold border">Cancel</button>
                    <button type="button" onClick={()=>{ if(nextApptDate) { setManagementEntries(prev=> [...prev, { id:'appt-'+Date.now(), title:'Next Appointment', body: `Scheduled for ${nextApptDate}. ${nextApptReason}`, date: nextApptDate, category:'Follow-up', priority:'Important' }]); setShowNextAppt(false); setNextApptDate(''); setNextApptReason(''); }}} className="px-4 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white">Save Appointment</button>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-slate-400">No follow-up scheduled. Only doctors can create next appointments.</div>
              )}
            </div>
          </div>
        )}
        </div>
      </div>

      {/* ---------- DIALOGS ---------- */}
      {showComplaintDlg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={()=> setShowComplaintDlg(false)} />
          <div className="relative bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-lg border border-light-border dark:border-dark-border animate-in zoom-in duration-200">
            <div className="px-5 py-4 border-b border-light-border dark:border-dark-border flex items-center justify-between">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center space-x-2"><FileText className="w-4 h-4 text-emerald-600" /><span>{editingComplaintId? 'Edit':'Add'} Complaint & History Entry</span></h3>
              <button onClick={()=> setShowComplaintDlg(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-surface"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div><label className={labelCls}>Title / Section*</label><input value={complaintDlgTitle} onChange={e=> setComplaintDlgTitle(e.target.value)} placeholder="e.g. Presenting Complaint, Past Medical History..." className={inputCls} /></div>
              <div><label className={labelCls}>Complaint*</label><input value={complaintDlgComplaint} onChange={e=> setComplaintDlgComplaint(e.target.value)} placeholder="e.g. Headache, fever, abdominal pain..." className={inputCls} /></div>
              <div><label className={labelCls}>Details*</label><textarea rows={4} value={complaintDlgBody} onChange={e=> setComplaintDlgBody(e.target.value)} placeholder="Enter detailed narrative, onset, duration, severity..." className={inputCls} /></div>
            </div>
            <div className="px-5 py-3 bg-slate-50 dark:bg-dark-surface/60 rounded-b-2xl flex justify-end space-x-2">
              <button onClick={()=> setShowComplaintDlg(false)} className="px-4 py-2 rounded-xl text-xs font-bold border border-light-border dark:border-dark-border hover:bg-white">Cancel</button>
              <button onClick={saveComplaint} className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm">{editingComplaintId? 'Update':'Add Entry'}</button>
            </div>
          </div>
        </div>
      )}

      {showExamDlg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={()=> setShowExamDlg(false)} />
          <div className="relative bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-lg border border-light-border dark:border-dark-border animate-in zoom-in">
            <div className="px-5 py-4 border-b border-light-border dark:border-dark-border flex items-center justify-between">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center space-x-2"><HeartPulse className="w-4 h-4 text-blue-600" /><span>{editingExamId? 'Edit':'Add'} Examination Finding</span></h3>
              <button onClick={()=> setShowExamDlg(false)} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div><label className={labelCls}>System*</label>
                <select value={examDlgSystem} onChange={e=> setExamDlgSystem(e.target.value)} className={inputCls}>
                  {EXAM_SYSTEMS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>Title*</label><input value={examDlgTitle} onChange={e=> setExamDlgTitle(e.target.value)} placeholder="e.g. Inspection, Palpation, Auscultation..." className={inputCls} /></div>
              <div><label className={labelCls}>Examination Details*</label><textarea rows={4} value={examDlgBody} onChange={e=> setExamDlgBody(e.target.value)} placeholder="Describe examination findings..." className={inputCls} /></div>
            </div>
            <div className="px-5 py-3 bg-slate-50 dark:bg-dark-surface/60 rounded-b-2xl flex justify-end space-x-2">
              <button onClick={()=> setShowExamDlg(false)} className="px-4 py-2 rounded-xl text-xs font-bold border">Cancel</button>
              <button onClick={saveExam} className="px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm">{editingExamId? 'Update':'Add Finding'}</button>
            </div>
          </div>
        </div>
      )}

      {showDiagDlg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={()=> setShowDiagDlg(false)} />
          <div className="relative bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-lg border animate-in zoom-in">
            <div className="px-5 py-4 border-b flex items-center justify-between"><h3 className="font-extrabold text-sm flex items-center space-x-2"><FilePlus2 className="w-4 h-4 text-rose-600" /><span>{editingDiagId? 'Edit':'Add'} Clinical Impression / Diagnosis</span></h3><button onClick={()=> setShowDiagDlg(false)} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button></div>
            <div className="p-5 space-y-3">
              <label className="flex items-center space-x-2 text-xs font-bold cursor-pointer"><input type="checkbox" checked={diagDlgIsCoded} onChange={e=> setDiagDlgIsCoded(e.target.checked)} className="rounded text-rose-600" /><span>Coded Diagnosis (ICD-10)</span></label>
              {diagDlgIsCoded ? (
                <>
                  <div><label className={labelCls}>ICD Code*</label><input value={diagDlgCode} onChange={e=> setDiagDlgCode(e.target.value)} placeholder="e.g. B50.9" className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border font-mono text-xs" /></div>
                  <div><label className={labelCls}>Diagnosis Description*</label><input value={diagDlgTitle} onChange={e=> setDiagDlgTitle(e.target.value)} placeholder="e.g. Plasmodium falciparum malaria" className={inputCls} /></div>
                  <div><label className={labelCls}>Type</label><select value={diagDlgType} onChange={e=> setDiagDlgType(e.target.value as any)} className={inputCls}><option value="Primary">Primary Diagnosis</option><option value="Secondary">Secondary Diagnosis</option></select></div>
                  <div><label className={labelCls}>Clinical Note (optional)</label><textarea rows={2} value={diagDlgBody} onChange={e=> setDiagDlgBody(e.target.value)} placeholder="Additional note..." className={inputCls} /></div>
                </>
              ) : (
                <>
                  <div><label className={labelCls}>Title*</label><input value={diagDlgTitle} onChange={e=> setDiagDlgTitle(e.target.value)} placeholder="e.g. Clinical Impression" className={inputCls} /></div>
                  <div><label className={labelCls}>Details*</label><textarea rows={3} value={diagDlgBody} onChange={e=> setDiagDlgBody(e.target.value)} placeholder="Describe impression..." className={inputCls} /></div>
                </>
              )}
            </div>
            <div className="px-5 py-3 bg-slate-50 dark:bg-dark-surface/60 rounded-b-2xl flex justify-end space-x-2">
              <button onClick={()=> setShowDiagDlg(false)} className="px-4 py-2 rounded-xl text-xs font-bold border">Cancel</button>
              <button onClick={saveDiag} className="px-5 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white">{editingDiagId? 'Update':'Add'}</button>
            </div>
          </div>
        </div>
      )}

      {showSurgeryDlg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={()=> setShowSurgeryDlg(false)} />
          <div className="relative bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-lg border border-light-border dark:border-dark-border animate-in zoom-in">
            <div className="px-5 py-4 border-b border-light-border dark:border-dark-border flex items-center justify-between">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center space-x-2"><FilePlus2 className="w-4 h-4 text-rose-600" /><span>{editingSurgeryId? 'Edit':'Add'} Surgery History</span></h3>
              <button onClick={()=> setShowSurgeryDlg(false)} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div><label className={labelCls}>Date of Surgery</label><input type="date" value={surgeryDlgDate} onChange={e=> setSurgeryDlgDate(e.target.value)} className={inputCls} /></div>
              <div><label className={labelCls}>Hospital / Center*</label><input value={surgeryDlgHospital} onChange={e=> setSurgeryDlgHospital(e.target.value)} placeholder="e.g. Lagos University Teaching Hospital..." className={inputCls} /></div>
              <div><label className={labelCls}>Type of Surgery*</label><input value={surgeryDlgType} onChange={e=> setSurgeryDlgType(e.target.value)} placeholder="e.g. Appendectomy, Hernia Repair..." className={inputCls} /></div>
              <div><label className={labelCls}>Notes</label><textarea rows={3} value={surgeryDlgNotes} onChange={e=> setSurgeryDlgNotes(e.target.value)} placeholder="Additional details about the surgery..." className={inputCls} /></div>
            </div>
            <div className="px-5 py-3 bg-slate-50 dark:bg-dark-surface/60 rounded-b-2xl flex justify-end space-x-2">
              <button onClick={()=> setShowSurgeryDlg(false)} className="px-4 py-2 rounded-xl text-xs font-bold border">Cancel</button>
              <button onClick={saveSurgery} className="px-5 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white">{editingSurgeryId? 'Update':'Add Surgery'}</button>
            </div>
          </div>
        </div>
      )}

      {showLabDlg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={()=> setShowLabDlg(false)} />
          <div className="relative bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-2xl border max-h-[90vh] flex flex-col animate-in zoom-in">
            <div className="px-5 py-4 border-b flex items-center justify-between flex-shrink-0"><h3 className="font-extrabold text-sm flex items-center space-x-2"><FlaskConical className="w-4 h-4 text-amber-600" /><span>Add Lab Orders</span></h3><button onClick={()=> setShowLabDlg(false)} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button></div>
            <div className="p-5 space-y-4 overflow-y-auto">
              <div><label className={labelCls}>Select Department*</label>
                <div className="flex flex-wrap gap-2">
                  {DEPARTMENTS.map(d=>(
                    <button key={d.id} type="button" onClick={()=> { setLabDlgDept(d.id); const first = labDefs.find(x=> x.category===d.id)?.id || ''; setLabDlgPick(first); }} className={`px-3 py-2 rounded-xl text-xs font-bold border ${labDlgDept===d.id? d.color+' text-white border-transparent shadow-md':'bg-white dark:bg-dark-surface border-light-border'}`}>{d.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelCls}>Select Investigation (dropdown)*</label>
                <div className="flex gap-2">
                  <select
                    value={labDlgPick}
                    onChange={e=> setLabDlgPick(e.target.value)}
                    className={inputCls + ' flex-1'}
                  >
                    {labDefs.filter(d=> d.category===labDlgDept).map(def=>(
                      <option key={def.id} value={def.id}>
                        {def.name} — {def.sampleType} • {settings.currency}{def.price.toLocaleString()} {def.turnaroundTime?`• ${def.turnaroundTime}`:''}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={handleLabDropdownAdd} disabled={!labDlgPick || labDlgSelectedIds.includes(labDlgPick)} className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center space-x-1 flex-shrink-0">
                    <Plus className="w-3.5 h-3.5" /><span>Add</span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Choose a test from the dropdown and click Add. You can add multiple investigations from the same department before confirming.</p>
                {labDlgSelectedIds.length>0 && (
                  <div className="mt-3 space-y-2">
                    <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300">Selected investigations ({labDlgSelectedIds.length}):</div>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                      {labDlgSelectedIds.map(id=>{
                        const def = labDefs.find(d=> d.id===id)!;
                        if(!def) return null;
                        return (
                          <div key={id} className="flex items-center justify-between p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs">
                            <div>
                              <div className="font-bold text-slate-900 dark:text-white">{def.name}</div>
                              <div className="text-[10px] text-slate-500">{def.sampleType} • TAT: {def.turnaroundTime} • {settings.currency}{def.price.toLocaleString()}</div>
                            </div>
                            <button type="button" onClick={()=> setLabDlgSelectedIds(prev=> prev.filter(x=>x!==id))} className="p-1.5 rounded-lg hover:bg-rose-100 text-rose-500"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className={labelCls}>Urgency / Priority</label><select value={labDlgPriority} onChange={e=> setLabDlgPriority(e.target.value as any)} className={inputCls}><option value="Routine">Routine</option><option value="Urgent">Urgent</option><option value="STAT">STAT (Emergency)</option></select></div>
                <div><label className={labelCls}>Clinical Indication</label><input value={labDlgNotes} onChange={e=> setLabDlgNotes(e.target.value)} placeholder="e.g. Febrile illness, suspected malaria" className={inputCls} /></div>
              </div>
            </div>
            <div className="px-5 py-3 bg-slate-50 dark:bg-dark-surface/60 rounded-b-2xl flex justify-between items-center flex-shrink-0">
              <span className="text-xs font-bold text-slate-600">{labDlgSelectedIds.length} test(s) • Est. {settings.currency}{labDefs.filter(d=> labDlgSelectedIds.includes(d.id)).reduce((s,t)=>s+t.price,0).toLocaleString()}</span>
              <div className="flex space-x-2">
                <button onClick={()=> setShowLabDlg(false)} className="px-4 py-2 rounded-xl text-xs font-bold border">Cancel</button>
                <button onClick={confirmLabAdd} disabled={labDlgSelectedIds.length===0} className="px-5 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-40">Add to Order</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRxDlg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={()=> setShowRxDlg(false)} />
          <div className="relative bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-xl border max-h-[90vh] flex flex-col animate-in zoom-in">
            <div className="px-5 py-4 border-b flex items-center justify-between flex-shrink-0"><h3 className="font-extrabold text-sm flex items-center space-x-2"><Pill className="w-4 h-4 text-purple-600" /><span>Add Prescription</span></h3><button onClick={()=> setShowRxDlg(false)} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button></div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <div><label className={labelCls}>Medication*</label><select value={rxDlgMedId} onChange={e=> setRxDlgMedId(e.target.value)} className={inputCls}>{medications.map(m=> <option key={m.id} value={m.id}>{m.name} ({m.strength}) • {settings.currency}{m.unitPrice} [Stock {m.currentStock}]</option>)}</select></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className={labelCls}>Dosage*</label><input value={rxDlgDosage} onChange={e=> setRxDlgDosage(e.target.value)} className={inputCls} placeholder="e.g. 1 tablet 500mg" /></div>
                <div><label className={labelCls}>Route</label><select value={rxDlgRoute} onChange={e=> setRxDlgRoute(e.target.value)} className={inputCls}><option>Oral</option><option>IV</option><option>IM</option><option>Topical</option><option>Inhalation</option><option>Sublingual</option></select></div>
                <div><label className={labelCls}>Frequency*</label><input value={rxDlgFrequency} onChange={e=> setRxDlgFrequency(e.target.value)} className={inputCls} /></div>
                <div><label className={labelCls}>Duration*</label><input value={rxDlgDuration} onChange={e=> setRxDlgDuration(e.target.value)} className={inputCls} /></div>
                <div><label className={labelCls}>Quantity*</label><input type="number" min={1} value={rxDlgQuantity} onChange={e=> setRxDlgQuantity(Number(e.target.value))} className={inputCls} /></div>
                <div><label className={labelCls}>Instructions</label><input value={rxDlgInstructions} onChange={e=> setRxDlgInstructions(e.target.value)} className={inputCls} /></div>
              </div>
              <button type="button" onClick={stageRx} className="w-full py-2 rounded-xl text-xs font-bold border-2 border-dashed border-purple-300 text-purple-700 hover:bg-purple-50 flex items-center justify-center space-x-1"><Plus className="w-3.5 h-3.5" /><span>Add another to list before saving ({rxStaging.length} staged)</span></button>
              {rxStaging.length>0 && <div className="space-y-1">{rxStaging.map((s,i)=>{ const m=medications.find(x=>x.id===s.medId); return <div key={i} className="text-xs p-2 rounded-lg bg-purple-50 dark:bg-purple-950/30 border border-purple-200 flex justify-between"><span className="font-bold">{m?.name} - {s.dosage} x {s.quantity}</span><button onClick={()=> setRxStaging(prev=> prev.filter((_,idx)=>idx!==i))} className="text-rose-500"><X className="w-3 h-3" /></button></div>; })}</div>}
            </div>
            <div className="px-5 py-3 bg-slate-50 dark:bg-dark-surface/60 rounded-b-2xl flex justify-end space-x-2 flex-shrink-0">
              <button onClick={()=> setShowRxDlg(false)} className="px-4 py-2 rounded-xl text-xs font-bold border">Cancel</button>
              <button onClick={confirmRx} className="px-5 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white shadow-sm">Confirm & Add to Prescription</button>
            </div>
          </div>
        </div>
      )}

      {showMgmtDlg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={()=> setShowMgmtDlg(false)} />
          <div className="relative bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-lg border animate-in zoom-in">
            <div className="px-5 py-4 border-b flex items-center justify-between"><h3 className="font-extrabold text-sm flex items-center space-x-2"><ClipboardList className="w-4 h-4 text-teal-600" /><span>{editingMgmtId? 'Edit':'Add'} Management Plan</span></h3><button onClick={()=> setShowMgmtDlg(false)} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button></div>
            <div className="p-5 space-y-3">
              <div><label className={labelCls}>Title*</label><select value={mgmtDlgTitle} onChange={e=> setMgmtDlgTitle(e.target.value)} className={inputCls}><option>Treatment Plan</option><option>Patient Advice & Counseling</option><option>Follow-up Instruction</option><option>Referral</option><option>Lifestyle Modification</option><option>Investigations to Follow</option><option>Clinical Note</option><option>Other</option></select></div>
              <div><label className={labelCls}>Category</label><select value={mgmtDlgCategory} onChange={e=> setMgmtDlgCategory(e.target.value)} className={inputCls}><option>Therapeutics</option><option>Advice</option><option>Follow-up</option><option>Referral</option><option>Prevention</option><option>Notes</option></select></div>
              <div><label className={labelCls}>Details / Plan*</label><textarea rows={3} value={mgmtDlgBody} onChange={e=> setMgmtDlgBody(e.target.value)} placeholder="Describe management, advice, education..." className={inputCls} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Follow-up / Due Date</label><input type="date" value={mgmtDlgDate} onChange={e=> setMgmtDlgDate(e.target.value)} className={inputCls} /></div>
                <div><label className={labelCls}>Priority</label><select value={mgmtDlgPriority} onChange={e=> setMgmtDlgPriority(e.target.value)} className={inputCls}><option>Routine</option><option>Urgent</option><option>ASAP</option></select></div>
              </div>
            </div>
            <div className="px-5 py-3 bg-slate-50 dark:bg-dark-surface/60 rounded-b-2xl flex justify-end space-x-2">
              <button onClick={()=> setShowMgmtDlg(false)} className="px-4 py-2 rounded-xl text-xs font-bold border">Cancel</button>
              <button onClick={saveMgmt} className="px-5 py-2 rounded-xl text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white">{editingMgmtId? 'Update':'Add to Plan'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Patients search dialog (after visit dropdown) — every row shows Profile */}
      {showPatientSearch && patient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setShowPatientSearch(false)} />
          <div className="relative bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-md border">
            <div className="px-5 py-4 border-b flex items-center justify-between"><h3 className="font-extrabold text-sm flex items-center space-x-2"><User className="w-4 h-4 text-rose-500" /><span>Find Patient</span></h3><button onClick={() => setShowPatientSearch(false)} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button></div>
            <div className="p-4 space-y-2">
              <input autoFocus value={patientSearch} onChange={e => setPatientSearch(e.target.value)} placeholder="Type name, hospital no, phone — list updates as you type..." className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border focus:ring-2 focus:ring-rose-500 focus:outline-none" />
              <div className="max-h-64 overflow-y-auto divide-y rounded-xl border">
                {patientSearchResults.map(p => (
                  <div key={p.id} onClick={() => { setCurrentPatientId(p.id); const vs = db.getVisits(p.id); setCurrentVisitId(vs[0]?.id || ''); if (onSelectPatient) onSelectPatient(p); setShowPatientSearch(false); }} className="px-3 py-2 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white">{p.firstName} {p.middleName || ''} {p.lastName} <span className="font-mono text-[10px] text-rose-600">({p.id})</span></div>
                      <div className="text-[11px] text-slate-500">{p.phone} • {p.sex}, {p.age}y • {db.getVisits(p.id).length} visit(s)</div>
                    </div>
                    {onOpenProfile && <button onClick={(e) => { e.stopPropagation(); onOpenProfile(p); }} className="px-2 py-1 rounded-lg text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 flex-shrink-0">Profile</button>}
                  </div>
                ))}
                {patientSearchResults.length === 0 && <div className="p-4 text-xs text-slate-400 text-center">No matches.</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admit dialog — ward must be specified */}
      {showAdmit && activeVisit && patient && (
        <AdmitDialog
          title={`Admit ${patient.firstName} ${patient.lastName}`}
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
