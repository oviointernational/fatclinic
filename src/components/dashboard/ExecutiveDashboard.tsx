import React from 'react';
import { db } from '../../services/db';
import { useCurrentUser } from '../../context/AuthContext';
import { Patient, Visit } from '../../types';
import { useSyncDb } from '../../hooks/useSyncDb';
import {
  Users,
  Stethoscope,
  Activity,
  FlaskConical,
  Pill,
  Radio,
  HeartPulse,
  Receipt,
  Clock,
  ArrowUpRight
} from 'lucide-react';
import { ClinicalDashboard } from '../clinical/ClinicalDashboard';

interface ExecutiveDashboardProps {
  onNavigatePatients: () => void;
  onNavigateClinical: () => void;
  onNavigateLab: (category?: string) => void;
  onNavigatePharmacy: () => void;
  onNavigateRadiology?: () => void;
  onNavigatePhysiotherapy?: () => void;
  onNavigateBilling: () => void;
  onSelectPatient: (patient: Patient) => void;
  onOpenClinicalGroup?: (groupId: string | null, ward?: string | null) => void;
}

export const ExecutiveDashboard: React.FC<ExecutiveDashboardProps> = ({
  onNavigatePatients,
  onNavigateClinical,
  onNavigateLab,
  onNavigatePharmacy,
  onNavigateRadiology,
  onNavigatePhysiotherapy,
  onNavigateBilling,
  onSelectPatient,
  onOpenClinicalGroup,
}) => {
  const currentUser = useCurrentUser();
  useSyncDb();

  const patients = db.getPatients();
  const visits = db.getVisits();
  const labRequests = db.getLabRequests();
  const prescriptions = db.getPrescriptions();
  const medications = db.getMedications();
  const radiologyOrders = db.getRadiologyOrders();
  const physiotherapyOrders = db.getPhysiotherapyOrders();
  const invoices = db.getInvoices();
  const settings = db.getSettings();

  // Metrics
  const totalRevenue = invoices.reduce((sum, inv) => sum + inv.paidAmount, 0);
  const outstanding = invoices.reduce((sum, inv) => sum + inv.balance, 0);
  const pendingVisits = visits.filter(v => !['Completed', 'Discharged', 'Treated'].includes(v.status));
  const pendingLabs = labRequests.flatMap(r => r.tests).filter(t => t.status !== 'Released');

  const today = new Date().toISOString().split('T')[0];
  const todayVisits = visits.filter(v => v.visitDate === today);

  // Department stats
  const docAwait = todayVisits.filter(v => ['With Doctor', 'Awaiting Physician'].includes(v.status)).length;
  const docCons = todayVisits.filter(v => v.status === 'In Consultation').length;
  const nurseAwait = todayVisits.filter(v => ['Awaiting Vitals', 'With Nurse'].includes(v.status)).length;
  const vitalsToday = db.getVitals().filter(vt => (vt.recordedAt || '').slice(0, 10) === today).length;

  const allTests = labRequests.flatMap(r => r.tests);
  const labDone = allTests.filter(t => ['Released', 'Verified'].includes(t.status)).length;
  const labByCat = ['HEMATOLOGY', 'MICROBIOLOGY', 'CHEMICAL_PATHOLOGY', 'HISTOPATHOLOGY', 'MOLECULAR'].map(c => ({
    cat: c,
    n: allTests.filter(t => t.category === c).length,
  }));
  const labMax = Math.max(1, ...labByCat.map(x => x.n));

  const rxItems = prescriptions.flatMap(p => p.items);
  const rxPending = rxItems.filter(i => i.dispenseStatus !== 'Dispensed').length;
  const rxDone = rxItems.filter(i => i.dispenseStatus === 'Dispensed').length;
  const lowMeds = medications.filter(m => m.currentStock <= m.minStockAlert).length;

  const radDone = radiologyOrders.filter(o => ['Completed', 'Report Ready'].includes(o.status)).length;
  const physDone = physiotherapyOrders.filter(o => o.status === 'Completed').length;
  const physActive = physiotherapyOrders.filter(o => o.status === 'In Progress').length;

  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

  return (
    <div className="h-full flex flex-col select-text overflow-y-auto p-6 space-y-6">
      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-in fade-in duration-150">
        {/* Total Patients */}
        <div 
          onClick={onNavigatePatients}
          className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm hover:border-emerald-500/50 cursor-pointer transition-all"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Total Registered</span>
            <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
            {patients.length}
          </div>
          <div className="flex items-center space-x-1 text-[11px] text-emerald-600 mt-1 font-semibold">
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>Active clinical registry</span>
          </div>
        </div>

        {/* Active Encounters */}
        <div 
          onClick={onNavigateClinical}
          className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm hover:border-emerald-500/50 cursor-pointer transition-all"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Waiting & In-Care</span>
            <div className="w-8 h-8 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center">
              <Stethoscope className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
            {pendingVisits.length}
          </div>
          <div className="flex items-center space-x-1 text-[11px] text-amber-500 mt-1 font-semibold">
            <Clock className="w-3.5 h-3.5" />
            <span>Triage & Doctor Queue</span>
          </div>
        </div>

        {/* Pending Labs */}
        <div 
          onClick={() => onNavigateLab()}
          className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm hover:border-emerald-500/50 cursor-pointer transition-all"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Investigations</span>
            <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <FlaskConical className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
            {pendingLabs.length}
          </div>
          <div className="flex items-center space-x-1 text-[11px] text-slate-400 mt-1 font-semibold">
            <span>4 Pathology Departments</span>
          </div>
        </div>

        {/* Hospital Revenue */}
        <div 
          onClick={onNavigateBilling}
          className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm hover:border-emerald-500/50 cursor-pointer transition-all"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Collected Revenue</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
            {settings.currency}{totalRevenue.toLocaleString()}
          </div>
          <div className="flex items-center space-x-1 text-[11px] text-emerald-600 mt-1 font-semibold">
            <span>Paid hospital invoices</span>
          </div>
        </div>
      </div>

      {/* Hospital Departments Overview — every department visualized */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
            Hospital Departments Overview
          </h3>
          <span className="text-[11px] font-bold text-slate-400">Today • click a department to open it</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {/* Doctor */}
          <div
            onClick={onNavigateClinical}
            className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm hover:shadow-md hover:-translate-y-0.5 cursor-pointer transition-all"
          >
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center">
                <Stethoscope className="w-4 h-4" />
              </div>
              <span className="text-2xl font-black text-slate-900 dark:text-white">{docAwait + docCons}</span>
            </div>
            <div className="text-xs font-extrabold mt-2 text-slate-800 dark:text-slate-100">Doctor — Physician</div>
            <div className="mt-2 space-y-1.5 text-[11px] font-semibold text-slate-500">
              <div className="flex justify-between"><span>Awaiting doctor</span><strong>{docAwait}</strong></div>
              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-dark-surface overflow-hidden">
                <div style={{ width: `${pct(docAwait, docAwait + docCons)}%` }} className="h-full bg-rose-500 rounded-full" />
              </div>
              <div className="flex justify-between"><span>In consultation</span><strong>{docCons}</strong></div>
            </div>
          </div>

          {/* Nursing */}
          <div
            onClick={onNavigateClinical}
            className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm hover:shadow-md hover:-translate-y-0.5 cursor-pointer transition-all"
          >
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-xl bg-teal-100 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 flex items-center justify-center">
                <Activity className="w-4 h-4" />
              </div>
              <span className="text-2xl font-black text-slate-900 dark:text-white">{nurseAwait + vitalsToday}</span>
            </div>
            <div className="text-xs font-extrabold mt-2 text-slate-800 dark:text-slate-100">Nursing — Triage</div>
            <div className="mt-2 space-y-1.5 text-[11px] font-semibold text-slate-500">
              <div className="flex justify-between"><span>Awaiting vitals</span><strong>{nurseAwait}</strong></div>
              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-dark-surface overflow-hidden">
                <div style={{ width: `${pct(nurseAwait, nurseAwait + vitalsToday)}%` }} className="h-full bg-teal-500 rounded-full" />
              </div>
              <div className="flex justify-between"><span>Vitals recorded</span><strong>{vitalsToday}</strong></div>
            </div>
          </div>

          {/* Laboratory */}
          <div
            onClick={() => onNavigateLab()}
            className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm hover:shadow-md hover:-translate-y-0.5 cursor-pointer transition-all"
          >
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                <FlaskConical className="w-4 h-4" />
              </div>
              <span className="text-2xl font-black text-slate-900 dark:text-white">{allTests.length}</span>
            </div>
            <div className="text-xs font-extrabold mt-2 text-slate-800 dark:text-slate-100">Laboratory — 5 Depts</div>
            <div className="mt-2 space-y-1">
              {labByCat.map(x => (
                <div key={x.cat} className="flex items-center space-x-2 text-[10px] font-bold text-slate-500">
                  <span className="w-20 truncate">{x.cat.replace('_', ' ')}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-dark-surface overflow-hidden">
                    <div style={{ width: `${pct(x.n, labMax)}%` }} className="h-full bg-amber-500 rounded-full" />
                  </div>
                  <strong className="w-6 text-right">{x.n}</strong>
                </div>
              ))}
              <div className="text-[11px] font-semibold text-slate-500 pt-0.5">
                Released <strong className="text-emerald-600">{labDone}</strong> • Pending <strong className="text-amber-600">{allTests.length - labDone}</strong>
              </div>
            </div>
          </div>

          {/* Pharmacy */}
          <div
            onClick={onNavigatePharmacy}
            className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm hover:shadow-md hover:-translate-y-0.5 cursor-pointer transition-all"
          >
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                <Pill className="w-4 h-4" />
              </div>
              <span className="text-2xl font-black text-slate-900 dark:text-white">{rxItems.length}</span>
            </div>
            <div className="text-xs font-extrabold mt-2 text-slate-800 dark:text-slate-100">Pharmacy — Rx Items</div>
            <div className="mt-2 space-y-1.5 text-[11px] font-semibold text-slate-500">
              <div className="flex justify-between"><span>Pending dispense</span><strong>{rxPending}</strong></div>
              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-dark-surface overflow-hidden">
                <div style={{ width: `${pct(rxPending, rxItems.length)}%` }} className="h-full bg-purple-500 rounded-full" />
              </div>
              <div className="flex justify-between"><span>Dispensed</span><strong className="text-emerald-600">{rxDone}</strong></div>
              <div className="flex justify-between"><span>Low-stock drugs</span><strong className={lowMeds > 0 ? 'text-rose-600' : ''}>{lowMeds}</strong></div>
            </div>
          </div>

          {/* Radiology */}
          <div
            onClick={() => onNavigateRadiology && onNavigateRadiology()}
            className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm hover:shadow-md hover:-translate-y-0.5 cursor-pointer transition-all"
          >
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                <Radio className="w-4 h-4" />
              </div>
              <span className="text-2xl font-black text-slate-900 dark:text-white">{radiologyOrders.length}</span>
            </div>
            <div className="text-xs font-extrabold mt-2 text-slate-800 dark:text-slate-100">Radiology — Imaging</div>
            <div className="mt-2 space-y-1.5 text-[11px] font-semibold text-slate-500">
              <div className="flex justify-between"><span>Reported / done</span><strong className="text-emerald-600">{radDone}</strong></div>
              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-dark-surface overflow-hidden">
                <div style={{ width: `${pct(radDone, radiologyOrders.length)}%` }} className="h-full bg-indigo-500 rounded-full" />
              </div>
              <div className="flex justify-between"><span>Awaiting report</span><strong>{radiologyOrders.length - radDone}</strong></div>
            </div>
          </div>

          {/* Physiotherapy */}
          <div
            onClick={() => onNavigatePhysiotherapy && onNavigatePhysiotherapy()}
            className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm hover:shadow-md hover:-translate-y-0.5 cursor-pointer transition-all"
          >
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-xl bg-teal-100 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 flex items-center justify-center">
                <HeartPulse className="w-4 h-4" />
              </div>
              <span className="text-2xl font-black text-slate-900 dark:text-white">{physiotherapyOrders.length}</span>
            </div>
            <div className="text-xs font-extrabold mt-2 text-slate-800 dark:text-slate-100">Physiotherapy — Rehab</div>
            <div className="mt-2 space-y-1.5 text-[11px] font-semibold text-slate-500">
              <div className="flex justify-between"><span>In progress</span><strong className="text-blue-600">{physActive}</strong></div>
              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-dark-surface overflow-hidden">
                <div style={{ width: `${pct(physDone, physiotherapyOrders.length)}%` }} className="h-full bg-teal-500 rounded-full" />
              </div>
              <div className="flex justify-between"><span>Completed</span><strong className="text-emerald-600">{physDone}</strong></div>
            </div>
          </div>

          {/* Billing */}
          <div
            onClick={onNavigateBilling}
            className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm hover:shadow-md hover:-translate-y-0.5 cursor-pointer transition-all"
          >
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Receipt className="w-4 h-4" />
              </div>
              <span className="text-2xl font-black text-slate-900 dark:text-white">{invoices.length}</span>
            </div>
            <div className="text-xs font-extrabold mt-2 text-slate-800 dark:text-slate-100">Billing — Invoices</div>
            <div className="mt-2 space-y-1.5 text-[11px] font-semibold text-slate-500">
              <div className="flex justify-between"><span>Collected</span><strong className="text-emerald-600">{settings.currency}{totalRevenue.toLocaleString()}</strong></div>
              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-dark-surface overflow-hidden">
                <div style={{ width: `${pct(totalRevenue, totalRevenue + outstanding)}%` }} className="h-full bg-emerald-500 rounded-full" />
              </div>
              <div className="flex justify-between"><span>Outstanding</span><strong className="text-rose-600">{settings.currency}{outstanding.toLocaleString()}</strong></div>
            </div>
          </div>

          {/* Front Desk */}
          <div
            onClick={onNavigatePatients}
            className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm hover:shadow-md hover:-translate-y-0.5 cursor-pointer transition-all"
          >
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <Users className="w-4 h-4" />
              </div>
              <span className="text-2xl font-black text-slate-900 dark:text-white">{patients.length}</span>
            </div>
            <div className="text-xs font-extrabold mt-2 text-slate-800 dark:text-slate-100">Front Desk — Patients</div>
            <div className="mt-2 space-y-1.5 text-[11px] font-semibold text-slate-500">
              <div className="flex justify-between"><span>Registered</span><strong>{patients.length}</strong></div>
              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-dark-surface overflow-hidden">
                <div style={{ width: `${pct(pendingVisits.length, visits.length)}%` }} className="h-full bg-blue-500 rounded-full" />
              </div>
              <div className="flex justify-between"><span>Active encounters</span><strong>{pendingVisits.length}</strong></div>
            </div>
          </div>
        </div>
      </div>

      {/* Clinical Flow Dashboard — jumps into Clinical Dashboard filtered */}
      <ClinicalDashboard
        selectedGroup={null}
        onSelect={(g, w) => {
          if (g && onOpenClinicalGroup) onOpenClinicalGroup(g, w);
          else if (g) onNavigateClinical();
        }}
      />

      {/* Real-Time Clinical Activity Feeds */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Active Patients Queue */}
        <div className="p-5 rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-3">
            <div className="flex items-center space-x-2">
              <Clock className="w-4 h-4 text-emerald-500" />
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-white">
                Live Patient Visits Queue ({visits.length})
              </h3>
            </div>
            <button
              onClick={onNavigatePatients}
              className="text-xs font-bold text-emerald-600 hover:text-emerald-700"
            >
              View All Patients →
            </button>
          </div>

          <div className="space-y-2.5">
            {visits.slice(0, 4).map(v => {
              const p = db.getPatientById(v.patientId);

              return (
                <div
                  key={v.id}
                  onClick={() => p && onSelectPatient(p)}
                  className="p-3 rounded-2xl bg-slate-50 dark:bg-dark-surface/50 border border-light-border dark:border-dark-border hover:border-emerald-500/40 cursor-pointer flex items-center justify-between transition-all"
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-bold flex items-center justify-center text-xs">
                      {p?.firstName[0]}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white">
                        {p?.firstName} {p?.lastName}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {v.patientId} • Encounter: {v.visitDate} ({v.visitType})
                      </div>
                    </div>
                  </div>

                  <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                    ['Completed', 'Discharged', 'Treated'].includes(v.status) ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {v.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 4 Pathology Field Workload Summary */}
        <div className="p-5 rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-3">
            <div className="flex items-center space-x-2">
              <FlaskConical className="w-4 h-4 text-amber-500" />
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-white">
                Laboratory Department Distribution
              </h3>
            </div>
            <button
              onClick={() => onNavigateLab()}
              className="text-xs font-bold text-amber-600 hover:text-amber-700"
            >
              Open Lab Desk →
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div
              onClick={() => onNavigateLab('hematology')}
              className="p-3.5 rounded-2xl bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/50 cursor-pointer hover:scale-[1.02] hover:border-rose-400 transition-all select-text"
            >
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-rose-600">1. Hematology</div>
              <div className="text-base font-black text-slate-900 dark:text-white mt-1">FBC, PCV, ESR</div>
              <span className="text-[10px] text-slate-400">Diagnostic Blood Panels →</span>
            </div>

            <div
              onClick={() => onNavigateLab('microbiology')}
              className="p-3.5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 cursor-pointer hover:scale-[1.02] hover:border-amber-400 transition-all select-text"
            >
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-amber-600">2. Microbiology</div>
              <div className="text-base font-black text-slate-900 dark:text-white mt-1">MP, MCS, Culture</div>
              <span className="text-[10px] text-slate-400">Pathogens & Microscopy →</span>
            </div>

            <div
              onClick={() => onNavigateLab('chemical_pathology')}
              className="p-3.5 rounded-2xl bg-teal-50/50 dark:bg-teal-950/20 border border-teal-200 dark:border-teal-900/50 cursor-pointer hover:scale-[1.02] hover:border-teal-400 transition-all select-text"
            >
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-teal-600">3. Chemical Path</div>
              <div className="text-base font-black text-slate-900 dark:text-white mt-1">LFT, U&E, HbA1c</div>
              <span className="text-[10px] text-slate-400">Biochemical Chemistry →</span>
            </div>

            <div
              onClick={() => onNavigateLab('histopathology')}
              className="p-3.5 rounded-2xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/50 cursor-pointer hover:scale-[1.02] hover:border-purple-400 transition-all select-text"
            >
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-purple-600">4. Histopathology</div>
              <div className="text-base font-black text-slate-900 dark:text-white mt-1">Biopsy & Cytology</div>
              <span className="text-[10px] text-slate-400">Tissue & Cellular Histology →</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
