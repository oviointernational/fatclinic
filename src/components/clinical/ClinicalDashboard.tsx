import React from 'react';
import { db } from '../../services/db';
import { useSyncDb } from '../../hooks/useSyncDb';
import { Visit, wardName } from '../../types';
import {
  Clock,
  Activity,
  Stethoscope,
  Syringe,
  FlaskConical,
  Pill,
  Wallet,
  BedDouble,
  CheckCircle2,
  LayoutGrid,
  X,
} from 'lucide-react';

export interface ClinicalGroup {
  id: string;
  label: string;
  statuses: Visit['status'][];
  todayOnly: boolean;
  accent: string;
  tile: string;
  icon: React.ReactNode;
}

export const CLINICAL_GROUPS: ClinicalGroup[] = [
  { id: 'triage', label: 'Awaiting Triage', statuses: ['Awaiting Vitals'], todayOnly: true, accent: 'bg-amber-500', tile: 'bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400', icon: <Clock className="w-5 h-5" /> },
  { id: 'nursing', label: 'With Nurse', statuses: ['With Nurse'], todayOnly: true, accent: 'bg-teal-500', tile: 'bg-teal-100 text-teal-600 dark:bg-teal-950/60 dark:text-teal-400', icon: <Activity className="w-5 h-5" /> },
  { id: 'doctor', label: 'With Doctor', statuses: ['With Doctor', 'Awaiting Physician'], todayOnly: true, accent: 'bg-violet-500', tile: 'bg-violet-100 text-violet-600 dark:bg-violet-950/60 dark:text-violet-300', icon: <Stethoscope className="w-5 h-5" /> },
  { id: 'consulting', label: 'In Consultation', statuses: ['In Consultation'], todayOnly: true, accent: 'bg-blue-500', tile: 'bg-blue-100 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400', icon: <Syringe className="w-5 h-5" /> },
  { id: 'lab', label: 'Awaiting Lab', statuses: ['Awaiting Lab'], todayOnly: true, accent: 'bg-amber-500', tile: 'bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400', icon: <FlaskConical className="w-5 h-5" /> },
  { id: 'pharmacy', label: 'Awaiting Pharmacy', statuses: ['Awaiting Pharmacy'], todayOnly: true, accent: 'bg-purple-500', tile: 'bg-purple-100 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400', icon: <Pill className="w-5 h-5" /> },
  { id: 'payment', label: 'Awaiting Payment', statuses: ['Awaiting Payment'], todayOnly: true, accent: 'bg-rose-500', tile: 'bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400', icon: <Wallet className="w-5 h-5" /> },
  { id: 'admitted', label: 'Admitted / In Ward', statuses: ['Admitted'], todayOnly: false, accent: 'bg-indigo-500', tile: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400', icon: <BedDouble className="w-5 h-5" /> },
  { id: 'discharged', label: 'Discharged / Treated', statuses: ['Discharged', 'Treated', 'Completed'], todayOnly: true, accent: 'bg-emerald-500', tile: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400', icon: <CheckCircle2 className="w-5 h-5" /> },
];

const todayStr = () => new Date().toISOString().split('T')[0];

/** Patient ids in a group (optionally narrowed to one ward for admitted). */
export function getClinicalGroupPatientIds(groupId: string, ward?: string | null): Set<string> {
  const group = CLINICAL_GROUPS.find(g => g.id === groupId);
  const ids = new Set<string>();
  if (!group) return ids;
  const today = todayStr();
  db.getVisits().forEach(v => {
    if (!group.statuses.includes(v.status)) return;
    if (group.todayOnly && v.visitDate !== today) return;
    if (groupId === 'admitted' && ward && v.ward !== ward) return;
    ids.add(v.patientId);
  });
  return ids;
}

export function getClinicalGroupCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  CLINICAL_GROUPS.forEach(g => {
    out[g.id] = getClinicalGroupPatientIds(g.id).size;
  });
  return out;
}

export function getAdmittedByWard(): Array<{ ward: string; count: number }> {
  const map = new Map<string, number>();
  db.getVisits().forEach(v => {
    if (v.status !== 'Admitted') return;
    // Keyed by ward CODE (what is stored); the label is resolved at render time.
    const w = v.ward || 'UNSPECIFIED';
    map.set(w, (map.get(w) || 0) + 1);
  });
  return [...map.entries()]
    .map(([ward, count]) => ({ ward, count }))
    .sort((a, b) => b.count - a.count);
}

interface ClinicalDashboardProps {
  selectedGroup: string | null;
  selectedWard?: string | null;
  onSelect: (groupId: string | null, ward?: string | null) => void;
}

/**
 * Clinical command dashboard: everything in the Doctor and Nursing sections
 * (triage, nursing, doctor, consulting, lab/pharmacy/payment queues, admitted
 * by ward, discharged). Click a card to list those patients below.
 */
export const ClinicalDashboard: React.FC<ClinicalDashboardProps> = ({ selectedGroup, selectedWard, onSelect }) => {
  useSyncDb();
  const counts = getClinicalGroupCounts();
  const wards = getAdmittedByWard();
  const flowTotal = CLINICAL_GROUPS.filter(g => g.todayOnly).reduce((s, g) => s + (counts[g.id] || 0), 0);
  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <div className="rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm p-5 md:p-6 space-y-5 flex-shrink-0">
      {/* Hero header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-rose-500 via-rose-600 to-amber-500 flex items-center justify-center text-white shadow-md">
            <LayoutGrid className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base md:text-lg font-extrabold tracking-tight text-slate-900 dark:text-white">
              Clinical Dashboard
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Doctor & Nursing flow • {todayLabel}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <span className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-[11px] font-extrabold text-emerald-700 dark:text-emerald-300">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>LIVE</span>
          </span>
          <span className="px-3 py-1.5 rounded-full bg-slate-100 dark:bg-dark-surface border border-light-border dark:border-dark-border text-[11px] font-extrabold text-slate-700 dark:text-slate-200">
            {flowTotal} in flow today{counts.admitted > 0 ? ` • ${counts.admitted} admitted` : ''}
          </span>
          {selectedGroup && (
            <button
              onClick={() => onSelect(null)}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-full text-[11px] font-bold bg-slate-900 hover:bg-slate-700 text-white transition-colors"
            >
              <X className="w-3 h-3" /><span>Clear filter</span>
            </button>
          )}
        </div>
      </div>

      {/* Flow cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        {CLINICAL_GROUPS.map(g => {
          const active = selectedGroup === g.id && (g.id !== 'admitted' || !selectedWard);
          return (
            <button
              key={g.id}
              onClick={() => onSelect(active ? null : g.id)}
              className={`relative overflow-hidden p-4 rounded-2xl bg-slate-50/60 dark:bg-dark-surface/50 border text-left transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lg ${
                active
                  ? 'border-slate-900 dark:border-white ring-2 ring-slate-900/10 dark:ring-white/20 shadow-md'
                  : 'border-light-border dark:border-dark-border hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${g.accent}`} />
              <div className="flex items-start justify-between pl-1.5">
                <span className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm ${g.tile}`}>
                  {g.icon}
                </span>
                <span className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">
                  {counts[g.id] || 0}
                </span>
              </div>
              <div className="text-[13px] font-extrabold mt-2.5 pl-1.5 text-slate-800 dark:text-slate-100">{g.label}</div>
              <div className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 pl-1.5 mt-0.5">
                {g.todayOnly ? "Today's flow" : 'Currently in ward'}
              </div>
            </button>
          );
        })}
      </div>

      {/* Ward census */}
      {wards.length > 0 && (
        <div className="rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/50 p-4">
          <div className="flex items-center space-x-2 mb-2.5">
            <BedDouble className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
              Patients in ward by ward
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {wards.map(w => {
              const active = selectedGroup === 'admitted' && selectedWard === w.ward;
              return (
                <button
                  key={w.ward}
                  onClick={() => onSelect(active ? null : 'admitted', active ? null : w.ward)}
                  className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all hover:-translate-y-0.5 ${
                    active
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-md'
                      : 'bg-white dark:bg-dark-card text-indigo-800 dark:text-indigo-200 border-indigo-200 dark:border-indigo-800 hover:shadow-md'
                  }`}
                >
                  <span>{wardName(w.ward === 'UNSPECIFIED' ? undefined : w.ward)}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-black ${active ? 'bg-white/20 text-white' : 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300'}`}>
                    {w.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
