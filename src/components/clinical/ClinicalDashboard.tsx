import React, { useMemo, useState } from 'react';
import { db } from '../../services/db';
import { useSyncDb } from '../../hooks/useSyncDb';
import { wardName } from '../../types';
import {
  CLINICAL_FLOW_GROUPS,
  RANGED_FLOW_GROUPS,
  WARD_CENSUS_GROUP_ID,
  admittedByWard,
  clinicalGroupCounts,
  type ClinicalFlowGroup,
} from '../../services/clinicalFlow';
import {
  buildWindow,
  describeWindow,
  type DateRangeMode,
  type DateWindow,
} from '../../services/dateRange';
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
  CalendarRange,
} from 'lucide-react';

/**
 * The presentation of each group: colour and icon.
 *
 * Kept apart from `clinicalFlow.ts` so that module stays free of React and of
 * `lucide-react`, which is what lets the self-test import it and check the
 * counting arithmetic. Adding an icon here cannot break the tests; adding one
 * there would have made the menu-style problem worse.
 */
interface GroupSkin {
  accent: string;
  tile: string;
  icon: React.ReactNode;
}

const SKINS: Record<string, GroupSkin> = {
  triage: { accent: 'bg-amber-500', tile: 'bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400', icon: <Clock className="w-5 h-5" /> },
  nursing: { accent: 'bg-teal-500', tile: 'bg-teal-100 text-teal-600 dark:bg-teal-950/60 dark:text-teal-400', icon: <Activity className="w-5 h-5" /> },
  doctor: { accent: 'bg-violet-500', tile: 'bg-violet-100 text-violet-600 dark:bg-violet-950/60 dark:text-violet-300', icon: <Stethoscope className="w-5 h-5" /> },
  consulting: { accent: 'bg-blue-500', tile: 'bg-blue-100 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400', icon: <Syringe className="w-5 h-5" /> },
  lab: { accent: 'bg-amber-500', tile: 'bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400', icon: <FlaskConical className="w-5 h-5" /> },
  pharmacy: { accent: 'bg-purple-500', tile: 'bg-purple-100 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400', icon: <Pill className="w-5 h-5" /> },
  payment: { accent: 'bg-rose-500', tile: 'bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400', icon: <Wallet className="w-5 h-5" /> },
  admitted: { accent: 'bg-indigo-500', tile: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400', icon: <BedDouble className="w-5 h-5" /> },
  discharged: { accent: 'bg-emerald-500', tile: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400', icon: <CheckCircle2 className="w-5 h-5" /> },
};

export interface ClinicalGroup extends ClinicalFlowGroup {
  accent: string;
  tile: string;
  icon: React.ReactNode;
}

/**
 * The groups with their presentation attached.
 *
 * Re-exported because callers used to import this name from here, and a rename
 * would have touched every consumer for no gain. The counting lives in
 * `clinicalFlow.ts`; this is that list plus what it looks like.
 */
export const CLINICAL_GROUPS: ClinicalGroup[] = CLINICAL_FLOW_GROUPS.map(g => ({
  ...g,
  accent: SKINS[g.id]?.accent ?? 'bg-slate-400',
  tile: SKINS[g.id]?.tile ?? 'bg-slate-100 text-slate-600',
  icon: SKINS[g.id]?.icon ?? <Activity className="w-5 h-5" />,
}));

export interface ClinicalDashboardProps {
  selectedGroup: string | null;
  selectedWard?: string | null;
  onSelect: (groupId: string | null, ward?: string | null) => void;
  /**
   * The window to count in. Omitted means this component's own choice is used.
   *
   * Held by the page rather than by this component so that the card numbers and
   * the patient list underneath are computed from one window. If each kept its
   * own, the count on a card and the names below it could disagree - and the
   * person would have no way to tell which was right.
   *
   * Only the finished window crosses that boundary, never the raw from/to
   * strings. Passing those would mean two copies of the inputs to keep in step,
   * and the classic result is a date box showing one range beside numbers
   * computed from another.
   */
  window?: DateWindow | null;
  onWindowChange?: (window: DateWindow | null) => void;
}

const RANGE_PRESETS: Array<{ id: Exclude<DateRangeMode, 'custom'>; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
];

/**
 * Clinical command dashboard: everything in the Doctor and Nursing sections
 * (triage, nursing, doctor, consulting, lab/pharmacy/payment queues, admitted
 * by ward, discharged). Click a card to list those patients below.
 *
 * The date range is chosen here and applies to every flow card. The ward census
 * is the exception, and it says so: see `clinicalFlow.ts` for why narrowing it
 * would be dangerous.
 */
export const ClinicalDashboard: React.FC<ClinicalDashboardProps> = ({
  selectedGroup,
  selectedWard,
  onSelect,
  window,
  onWindowChange,
}) => {
  useSyncDb();

  // The date inputs live here and only here. The page receives the finished
  // window so that its patient list counts the same way the cards do, and does
  // not keep its own copy of what was typed.
  const [mode, setMode] = useState<DateRangeMode>('today');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const built = useMemo(
    () => buildWindow({ mode, from, to }),
    [mode, from, to],
  );
  const { window: ownWindow, error } = built;

  // A parent holding a window is authoritative; otherwise this component's own.
  const win = window !== undefined ? window : ownWindow;

  // Report upwards only when this component is the one that chose, or the page
  // can never learn the range.
  const report = (next: DateWindow | null) => { if (onWindowChange) onWindowChange(next); };

  const choosePreset = (preset: Exclude<DateRangeMode, 'custom'>) => {
    setMode(preset);
    setFrom('');
    setTo('');
    report(buildWindow({ mode: preset }).window);
  };

  const setCustom = (nextFrom: string, nextTo: string) => {
    setMode('custom');
    setFrom(nextFrom);
    setTo(nextTo);
    // Reported from the built result, so an unfinished range reports an error
    // rather than a window that quietly covers something else.
    report(buildWindow({ mode: 'custom', from: nextFrom, to: nextTo }).window);
  };

  // One pass over the encounters, so every card on the screen agrees about what
  // is in range. `db.getVisits()` is read once for the same reason.
  const { counts, wards, flowTotal } = useMemo<{
    counts: Record<string, number>;
    wards: Array<{ ward: string; count: number }>;
    flowTotal: number;
  }>(() => {
    const visits = db.getVisits();
    const c = clinicalGroupCounts(visits, win);
    return {
      counts: c,
      wards: admittedByWard(visits),
      // Built from `c`, not from a name being defined in this same object.
      flowTotal: RANGED_FLOW_GROUPS.reduce((s, g) => s + (c[g.id] || 0), 0),
    };
  }, [win]);

  /*
   * Keyed on the chosen `mode`, not on the window.
   *
   * "All time" builds to a NULL window - no restriction at all - so testing the
   * window for "is this today?" answers yes for All time, and the screen said
   * "Encounters dated today" with "Today's flow" under every card while counting
   * every encounter ever saved. That is precisely the caption-over-all-time-numbers
   * mistake `dateRange.ts` was written to stop, reintroduced through the back door
   * by treating "no window" as "a window for one day".
   */
  const showingToday = mode === 'today';
  const showingAllTime = mode === 'all';
  const wardCensusIgnoresRange = !showingToday && !showingAllTime;

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
              Doctor &amp; Nursing flow • {describeWindow(win)}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <span className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-[11px] font-extrabold text-emerald-700 dark:text-emerald-300">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>LIVE</span>
          </span>
          <span className="px-3 py-1.5 rounded-full bg-slate-100 dark:bg-dark-surface border border-light-border dark:border-dark-border text-[11px] font-extrabold text-slate-700 dark:text-slate-200">
            {flowTotal} in flow{counts.admitted > 0 ? ` • ${counts.admitted} admitted` : ''}
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

      {/* The date range. Every flow card above and the patient list below are
          filtered by it, which is why the chosen range is named in the header
          rather than left as a caption. */}
      <div className="rounded-2xl bg-slate-50/70 dark:bg-dark-surface/40 border border-light-border dark:border-dark-border px-3 py-2.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 px-1 flex items-center gap-1.5">
            <CalendarRange className="w-3.5 h-3.5" />
            Encounter dates • {describeWindow(win)}
          </span>

          <div className="flex items-center space-x-1 bg-slate-100 dark:bg-dark-surface p-1 rounded-xl text-xs font-bold overflow-x-auto">
            {RANGE_PRESETS.map(preset => (
              <button
                key={preset.id}
                onClick={() => choosePreset(preset.id)}
                aria-pressed={mode === preset.id}
                className={`px-3 py-1.5 rounded-xl whitespace-nowrap transition-all ${
                  mode === preset.id
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {preset.label}
              </button>
            ))}
            <button
              onClick={() => { setMode('custom'); setFrom(''); setTo(''); report(null); }}
              aria-pressed={mode === 'custom'}
              className={`px-3 py-1.5 rounded-xl whitespace-nowrap transition-all ${
                mode === 'custom'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Pick dates
            </button>
          </div>
        </div>

        {/* Keyed on the chosen mode, not on `win`: an unfinished custom range
            builds to a null window, and keying on the window would make the date
            boxes vanish the moment a person cleared one of them. */}
        {mode === 'custom' && (
          <div className="flex flex-wrap items-end gap-2 px-1 pb-0.5">
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">From</span>
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={e => setCustom(e.target.value, to)}
                className="px-2 py-1.5 text-[11px] rounded-lg border border-light-border dark:border-dark-border bg-white dark:bg-dark-card text-slate-700 dark:text-slate-200"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">To</span>
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={e => setCustom(from, e.target.value)}
                className="px-2 py-1.5 text-[11px] rounded-lg border border-light-border dark:border-dark-border bg-white dark:bg-dark-card text-slate-700 dark:text-slate-200"
              />
            </label>
            {(from || to) && (
              <button
                onClick={() => setCustom('', '')}
                className="px-2.5 py-1.5 text-[11px] font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg border border-light-border dark:border-dark-border"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {error && (
          <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 px-1">{error}</p>
        )}

        {/* The note that used to sit here explained what the cards count and that
            the ward census ignores the range. It was asked to be removed, and the
            two facts it carried are still on the screen in a shorter form: every
            card says "Today's flow" / "Dated in range" / "Any date", the header
            names the range, and the ward census keeps its own "all dates" badge.
            Nothing here is load-bearing. */}
      </div>

      {/* Flow cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        {CLINICAL_GROUPS.map(g => {
          const active = selectedGroup === g.id && (g.id !== WARD_CENSUS_GROUP_ID || !selectedWard);
          const caption = g.id === WARD_CENSUS_GROUP_ID
            ? 'In a ward now'
            : showingToday
              ? "Today's flow"
              : showingAllTime
                ? 'Any date'
                : 'Dated in range';
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
                {caption}
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
            {wardCensusIgnoresRange && (
              <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                all dates
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {wards.map((w: { ward: string; count: number }) => {
              const active = selectedGroup === WARD_CENSUS_GROUP_ID && selectedWard === w.ward;
              return (
                <button
                  key={w.ward}
                  onClick={() => onSelect(active ? null : WARD_CENSUS_GROUP_ID, active ? null : w.ward)}
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
