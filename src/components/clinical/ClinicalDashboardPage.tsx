import React, { useMemo, useState } from 'react';
import { Patient, Visit, wardName } from '../../types';
import { db } from '../../services/db';
import { useSyncDb } from '../../hooks/useSyncDb';
import { ClinicalDashboard } from './ClinicalDashboard';
import { clinicalGroupPatientIds, findFlowGroup, WARD_CENSUS_GROUP_ID } from '../../services/clinicalFlow';
import { buildWindow, describeWindow, type DateWindow } from '../../services/dateRange';
import { User, Stethoscope, Activity, X } from 'lucide-react';

interface ClinicalDashboardPageProps {
  onOpenProfile?: (patient: Patient) => void;
  onSelectPatient?: (patient: Patient) => void;
  onSelectVisit?: (visit: Visit) => void;
  onNavigateConsultation?: () => void;
  onNavigateNursing?: () => void;
  initialGroup?: string | null;
  initialWard?: string | null;
  /**
   * The window the cards are counting in, held here so the list below is built
   * from the same one. Defaults to today, which is what the dashboard showed
   * before a range could be chosen.
   */
  initialWindow?: DateWindow | null;
}

const TODAY_WINDOW = buildWindow({ mode: 'today' }).window;

/**
 * Standalone Clinical Dashboard (Clinical Care & Triage → Clinical Dashboard).
 * Doctor + Nursing flow overview; click a card or ward chip to list patients,
 * then jump to Profile, Physician Consultation or Nursing Triage.
 */
export const ClinicalDashboardPage: React.FC<ClinicalDashboardPageProps> = ({
  onOpenProfile,
  onSelectPatient,
  onSelectVisit,
  onNavigateConsultation,
  onNavigateNursing,
  initialGroup,
  initialWard,
  initialWindow,
}) => {
  useSyncDb();
  const [group, setGroup] = useState<string | null>(initialGroup || null);
  const [ward, setWard] = useState<string | null>(initialWard || null);
  const [window, setWindow] = useState<DateWindow | null>(
    initialWindow !== undefined ? initialWindow : TODAY_WINDOW,
  );

  // Preset from Executive Overview (or elsewhere) — apply when it changes.
  React.useEffect(() => {
    if (initialGroup !== undefined) setGroup(initialGroup);
    if (initialWard !== undefined) setWard(initialWard);
  }, [initialGroup, initialWard]);

  const groupDef = group ? findFlowGroup(group) : null;
  const visits = useMemo(() => db.getVisits(), [window]);

  // The SAME window as the cards. If this were left out and defaulted to today
  // instead, a card could read 12 and the list below it show 3 people, with
  // nothing on screen to explain the difference.
  const ids = groupDef ? clinicalGroupPatientIds(visits, groupDef.id, window, ward) : new Set<string>();
  const patients: Patient[] = [...ids]
    .map(id => db.getPatientById(id))
    .filter((p): p is Patient => !!p);

  // NOTE: navigate first, then select — App's onNavigate clears clinical
  // selection, so the selection calls must be queued last to win batching.
  const openConsultation = (p: Patient) => {
    const latest = db.getVisits(p.id)[0];
    if (onNavigateConsultation) onNavigateConsultation();
    if (onSelectPatient) onSelectPatient(p);
    if (latest && onSelectVisit) onSelectVisit(latest);
  };

  const openNursing = (p: Patient) => {
    const latest = db.getVisits(p.id)[0];
    if (onNavigateNursing) onNavigateNursing();
    if (onSelectPatient) onSelectPatient(p);
    if (latest && onSelectVisit) onSelectVisit(latest);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <ClinicalDashboard
          selectedGroup={group}
          selectedWard={ward}
          onSelect={(g, w) => { setGroup(g); setWard(w || null); }}
          window={window}
          onWindowChange={setWindow}
        />

        {groupDef && (
          <div className="rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm overflow-hidden flex-shrink-0">
            <div className="px-4 py-2.5 border-b border-light-border dark:border-dark-border bg-slate-50 dark:bg-dark-surface/60 flex items-center justify-between">
              <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200">
                {groupDef.label}{ward ? ` — ${wardName(ward)}` : ''} ({patients.length} patient{patients.length === 1 ? '' : 's'})
              </span>
              {/* The list is filtered by the range chosen above, so it names the
                  range too. Without this, a list of 3 under a card reading 12
                  looks like a bug rather than a filter. */}
              <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                {group === WARD_CENSUS_GROUP_ID ? 'All dates' : describeWindow(window)}
              </span>
              <button
                onClick={() => { setGroup(null); setWard(null); }}
                className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-600"
              >
                <X className="w-3 h-3" /><span>Clear</span>
              </button>
            </div>
            {patients.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                No patients in this group{group === WARD_CENSUS_GROUP_ID ? '' : ` for ${describeWindow(window)}`}.
                {group === WARD_CENSUS_GROUP_ID
                  ? ' The ward census shows everyone in a ward now, on any date.'
                  : ' Try a wider range above — a status is where an encounter is now, so a wider range counts encounters that stayed in this state since.'}
              </div>
            ) : (
              <div className="divide-y divide-light-border/60 dark:divide-dark-border/60 max-h-[46vh] overflow-y-auto">
                {patients.map(p => {
                  const latest = db.getVisits(p.id)[0];
                  return (
                    <div key={p.id} className="px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50/60">
                      <div className="flex items-center space-x-3 min-w-0">
                        <div className="w-9 h-9 rounded-full bg-rose-100 dark:bg-rose-950/40 flex items-center justify-center text-sm font-bold text-rose-600 flex-shrink-0">
                          {p.firstName[0]}{p.lastName[0]}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {p.firstName} {p.lastName} <span className="font-mono text-[10px] text-slate-400">({p.id})</span>
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {p.sex}, {p.age}y • {p.phone}
                            {latest && (
                              <span> • <strong>{latest.status}</strong> ({latest.visitDate}{latest.status === 'Admitted' && latest.ward ? ` • Ward: ${wardName(latest.ward)}` : ''})</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-1.5 flex-shrink-0">
                        {onOpenProfile && (
                          <button onClick={() => onOpenProfile(p)} className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-600">
                            <User className="w-3 h-3" /><span>Profile</span>
                          </button>
                        )}
                        <button onClick={() => openConsultation(p)} className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-rose-600 hover:bg-rose-700 text-white">
                          <Stethoscope className="w-3 h-3" /><span>Consult</span>
                        </button>
                        <button onClick={() => openNursing(p)} className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-teal-600 hover:bg-teal-700 text-white">
                          <Activity className="w-3 h-3" /><span>Triage</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
