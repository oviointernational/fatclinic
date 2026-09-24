import React from 'react';
import { db } from '../../services/db';
import { useSyncDb } from '../../hooks/useSyncDb';
import { 
  TestTube, 
  Bug, 
  Dna, 
  Microscope, 
  CheckCircle2, 
  Clock, 
  ArrowRight,
  TrendingUp,
  Activity
} from 'lucide-react';
import { LabCategory } from '../../types';

interface LabOverviewProps {
  onNavigateDepartment?: (category: LabCategory) => void;
}

export const LabOverview: React.FC<LabOverviewProps> = ({ onNavigateDepartment }) => {
  useSyncDb();
  const labRequests = db.getLabRequests();

  const allTests = labRequests.flatMap(r => r.tests);
  const pendingCollection = allTests.filter(t => t.status === 'Requested').length;
  const inProcessing = allTests.filter(t => t.status === 'Processing' || t.status === 'Sample Collected').length;
  const resultsReady = allTests.filter(t => t.status === 'Result Entered').length;
  const released = allTests.filter(t => t.status === 'Released').length;

  const depts: Array<{ id: LabCategory; label: string; icon: React.ReactNode; color: string; bg: string }> = [
    { id: 'HEMATOLOGY', label: 'Hematology', icon: <TestTube className="w-5 h-5 text-rose-500" />, color: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800' },
    { id: 'MICROBIOLOGY', label: 'Medical Microbiology', icon: <Bug className="w-5 h-5 text-amber-500" />, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800' },
    { id: 'CHEMICAL_PATHOLOGY', label: 'Chemical Pathology', icon: <Dna className="w-5 h-5 text-teal-500" />, color: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-50 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800' },
    { id: 'HISTOPATHOLOGY', label: 'Histopathology', icon: <Microscope className="w-5 h-5 text-purple-500" />, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800' },
    { id: 'MOLECULAR', label: 'Molecular Biology', icon: <Dna className="w-5 h-5 text-indigo-500" />, color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800' }
  ];

  return (
    <div className="h-full flex flex-col select-text overflow-y-auto p-6 space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Awaiting Samples</span>
            <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
            {pendingCollection}
          </div>
          <span className="text-[10px] text-slate-400">Phlebotomy / specimen collection</span>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">In Processing</span>
            <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
            {inProcessing}
          </div>
          <span className="text-[10px] text-slate-400">Analyzers &amp; manual benches</span>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Results Entered</span>
            <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
            {resultsReady}
          </div>
          <span className="text-[10px] text-slate-400">Awaiting pathologist release</span>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Released Reports</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
            {released}
          </div>
          <span className="text-[10px] text-slate-400">Available to physicians &amp; print</span>
        </div>
      </div>

      <div className="space-y-3">
        <div className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
          Departmental Workload &amp; Bench Performance
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {depts.map(dept => {
            const deptTests = allTests.filter(t => t.category === dept.id);
            const deptReleased = deptTests.filter(t => t.status === 'Released').length;
            const deptPending = deptTests.filter(t => t.status !== 'Released').length;

            return (
              <div 
                key={dept.id} 
                className={`p-5 rounded-2xl border ${dept.bg} shadow-sm transition-all flex flex-col justify-between`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2.5">
                      {dept.icon}
                      <h3 className="font-extrabold text-slate-900 dark:text-white text-sm">
                        {dept.label}
                      </h3>
                    </div>
                    <span className="text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-white dark:bg-dark-card shadow-xs">
                      {deptTests.length} Total Tests
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
                    <div className="p-2.5 rounded-xl bg-white/70 dark:bg-dark-card/70">
                      <span className="text-[10px] text-slate-400 font-bold block">Active Orders:</span>
                      <strong className="text-base text-amber-600 dark:text-amber-400">{deptPending}</strong>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white/70 dark:bg-dark-card/70">
                      <span className="text-[10px] text-slate-400 font-bold block">Released:</span>
                      <strong className="text-base text-emerald-600 dark:text-emerald-400">{deptReleased}</strong>
                    </div>
                  </div>
                </div>

                {onNavigateDepartment && (
                  <button
                    onClick={() => onNavigateDepartment(dept.id)}
                    className="mt-4 flex items-center justify-between w-full px-3 py-2 rounded-xl text-xs font-bold bg-white dark:bg-dark-card hover:bg-slate-50 dark:hover:bg-dark-surface border border-light-border dark:border-dark-border text-slate-700 dark:text-slate-200 transition-all shadow-xs"
                  >
                    <span>Open {dept.label} Queue</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
