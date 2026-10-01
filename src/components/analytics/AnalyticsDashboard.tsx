import React, { useMemo, useState } from 'react';
import { Users, FlaskConical, Lock, CalendarRange } from 'lucide-react';
import { db } from '../../services/db';
import { useAccess } from '../../hooks/useAccess';
import {
  DATE_PRESETS, buildWindow, countUnreadable, describeWindow, withinWindow,
  type DateRangeMode,
} from '../../services/dateRange';

/**
 * Analytics & Reports.
 *
 * The figures here are computed inside `useMemo` from the window the person
 * chose, and every one of them goes through `withinWindow`. An earlier version
 * held a `dateFilter` state, showed it in the corner, and then computed every
 * figure over all records ever saved - so "This month" was a caption on top of
 * all-time numbers, which is the kind of thing that gets a clinic to believe it
 * earned less than it did.
 *
 * Revenue is gated separately. Patient statistics and laboratory workload are
 * clinical facts that a doctor needs; what the clinic earns and what patients
 * owe are not theirs, and a doctor holds `BILLING.INVOICES` for the invoice
 * numbers on their own orders, so the gate is on the person, not the permission.
 */
export const AnalyticsDashboard: React.FC = () => {
  const access = useAccess();
  const maySeeRevenue = access.canSeeRevenue();

  const [mode, setMode] = useState<DateRangeMode>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // `now` is read once per render rather than per record, so every figure in one
  // pass agrees about where "today" ends.
  const { window, error } = useMemo(
    () => buildWindow({ mode, from: customFrom, to: customTo }),
    [mode, customFrom, customTo],
  );

  const inRange = useMemo(() => {
    const settings = db.getSettings();

    const allInvoices = db.getInvoices();
    const invoices = allInvoices.filter(i => withinWindow(i.date, window));

    // A record with an unreadable date cannot be placed in a window, so it is
    // counted and the screen says so rather than the total quietly under-counting.
    const unreadable = countUnreadable(allInvoices.map(i => i.date));

    let revConsult = 0;
    let revLab = 0;
    let revRx = 0;
    let revNurse = 0;
    for (const inv of invoices) {
      for (const it of inv.items) {
        if (it.serviceCategory === 'Consultation') revConsult += it.totalPrice;
        else if (it.serviceCategory === 'Laboratory') revLab += it.totalPrice;
        else if (it.serviceCategory === 'Pharmacy') revRx += it.totalPrice;
        else revNurse += it.totalPrice;
      }
    }
    const grandRevenue = revConsult + revLab + revRx + revNurse;

    const allRequests = db.getLabRequests();
    const labRequests = allRequests.filter(r => withinWindow(r.requestedAt, window));

    let countHem = 0;
    let countMic = 0;
    let countChe = 0;
    let countHis = 0;
    let countMol = 0;
    for (const r of labRequests) {
      for (const t of r.tests) {
        if (t.category === 'HEMATOLOGY') countHem++;
        else if (t.category === 'MICROBIOLOGY') countMic++;
        else if (t.category === 'CHEMICAL_PATHOLOGY') countChe++;
        else if (t.category === 'HISTOPATHOLOGY') countHis++;
        else countMol++;
      }
    }
    const totalLabTests = countHem + countMic + countChe + countHis + countMol;

    const allVisits = db.getVisits();
    const visits = allVisits.filter(v => withinWindow(v.visitDate, window));
    const visitsUnreadable = countUnreadable(allVisits.map(v => v.visitDate));

    const patients = db.getPatients();
    const maleCount = patients.filter(p => p.sex === 'Male').length;
    const femaleCount = patients.filter(p => p.sex === 'Female').length;

    return {
      settings, invoices, unreadable,
      revConsult, revLab, revRx, revNurse, grandRevenue,
      countHem, countMic, countChe, countHis, countMol, totalLabTests,
      visits, visitsUnreadable, patients, maleCount, femaleCount,
    };
  }, [window]);

  const {
    settings, invoices, unreadable,
    revConsult, revLab, revRx, revNurse, grandRevenue,
    countHem, countMic, countChe, countHis, countMol, totalLabTests,
    visits, visitsUnreadable, patients, maleCount, femaleCount,
  } = inRange;

  const labBars: Array<[string, number, string, string]> = [
    ['Hematology (FBC, ESR, Coagulation)', countHem, 'text-rose-600', 'bg-rose-500'],
    ['Medical Microbiology (MP, Urine, Culture)', countMic, 'text-amber-600', 'bg-amber-500'],
    ['Chemical Pathology (LFT, U&E, HbA1c, Lipids)', countChe, 'text-teal-600', 'bg-teal-500'],
    ['Histopathology (Biopsy, Cytology, Pap Smear)', countHis, 'text-purple-600', 'bg-purple-500'],
    ['Molecular (PCR)', countMol, 'text-indigo-600', 'bg-indigo-500'],
  ];

  const revenueBars: Array<[string, number, string, string, string]> = [
    ['Consultations', revConsult, 'bg-rose-500', 'border-rose-200 dark:border-rose-900/50', 'text-rose-600'],
    ['Laboratory', revLab, 'bg-amber-500', 'border-amber-200 dark:border-amber-900/50', 'text-amber-600'],
    ['Pharmacy', revRx, 'bg-purple-500', 'border-purple-200 dark:border-purple-900/50', 'text-purple-600'],
    ['Nursing / Procedures', revNurse, 'bg-teal-500', 'border-teal-200 dark:border-teal-900/50', 'text-teal-600'],
  ];

  return (
    <div className="h-full flex flex-col select-text overflow-y-auto p-4 sm:p-6 space-y-6">
      {/* Period selection. Every figure below is filtered by what is chosen here. */}
      <div className="p-2.5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex-shrink-0 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 px-1 flex items-center gap-1.5">
            <CalendarRange className="w-3.5 h-3.5" />
            Analytics • {describeWindow(window)}
          </span>

          <div className="flex items-center space-x-1 bg-slate-100 dark:bg-dark-surface p-1 rounded-xl text-xs font-bold overflow-x-auto">
            {DATE_PRESETS.map(preset => (
              <button
                key={preset.id}
                onClick={() => setMode(preset.id)}
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
              onClick={() => setMode('custom')}
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

        {mode === 'custom' && (
          <div className="flex flex-wrap items-end gap-2 px-1 pb-0.5">
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">From</span>
              <input
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={e => setCustomFrom(e.target.value)}
                className="px-2 py-1.5 text-[11px] rounded-lg border border-light-border dark:border-dark-border bg-white dark:bg-dark-card text-slate-700 dark:text-slate-200"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">To</span>
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={e => setCustomTo(e.target.value)}
                className="px-2 py-1.5 text-[11px] rounded-lg border border-light-border dark:border-dark-border bg-white dark:bg-dark-card text-slate-700 dark:text-slate-200"
              />
            </label>
            {(customFrom || customTo) && (
              <button
                onClick={() => { setCustomFrom(''); setCustomTo(''); }}
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

        {!error && (
          <p className="text-[10px] text-slate-400 px-1">
            {invoices.length} invoice{invoices.length === 1 ? '' : 's'} and {visits.length} encounter
            {visits.length === 1 ? '' : 's'} fall inside this range
            {unreadable > 0 ? `, plus ${unreadable} invoice(s) whose date could not be read` : ''}
            {visitsUnreadable > 0 ? ` and ${visitsUnreadable} encounter(s) whose date could not be read` : ''}.
          </p>
        )}
      </div>

      {/* Revenue. Refused for clinical roles, in words, before any figure is drawn. */}
      {maySeeRevenue ? (
        <div className="p-6 rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Total Billed Volume</span>
              <div className="text-2xl font-black text-slate-900 dark:text-white mt-0.5">
                {settings.currency}{grandRevenue.toLocaleString()}
              </div>
            </div>
            <span className="text-xs font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1 rounded-xl">
              Departmental Revenue Split
            </span>
          </div>

          <div className="h-4 w-full rounded-full bg-slate-100 dark:bg-dark-surface flex overflow-hidden">
            {grandRevenue === 0 ? (
              <div className="w-full bg-slate-200 dark:bg-dark-surface" />
            ) : (
              <>
                <div style={{ width: `${(revConsult / grandRevenue) * 100}%` }} className="bg-rose-500" title="Consultation" />
                <div style={{ width: `${(revLab / grandRevenue) * 100}%` }} className="bg-amber-500" title="Laboratory" />
                <div style={{ width: `${(revRx / grandRevenue) * 100}%` }} className="bg-purple-500" title="Pharmacy" />
                <div style={{ width: `${(revNurse / grandRevenue) * 100}%` }} className="bg-teal-500" title="Nursing & Procedures" />
              </>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            {revenueBars.map(([label, value, bar, border, text]) => (
              <div key={label} className={`p-3 rounded-2xl bg-slate-50/60 dark:bg-dark-surface/40 border ${border}`}>
                <span className={`text-[10px] font-bold ${text} uppercase`}>{label}</span>
                <div className="text-base font-extrabold text-slate-900 dark:text-white mt-1">
                  {settings.currency}{value.toLocaleString()}
                </div>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className={`h-1.5 rounded-full ${bar} flex-shrink-0`} style={{ width: `${Math.min(100, (value / (grandRevenue || 1)) * 100)}%` }} />
                  <span className="text-[10px] text-slate-400 font-semibold">
                    {Math.round((value / (grandRevenue || 1)) * 100)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <RevenueRefused />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Laboratory workload */}
        <div className="p-6 rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-3">
            <div className="flex items-center space-x-2">
              <FlaskConical className="w-4 h-4 text-amber-500" />
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-white">
                Pathology Workload by Department
              </h3>
            </div>
            <span className="text-xs text-slate-400 font-bold">{totalLabTests} Total Ordered</span>
          </div>

          {totalLabTests === 0 ? (
            <EmptyRange what="pathology investigations" />
          ) : (
            <div className="space-y-3">
              {labBars.map(([label, count, text, bar]) => (
                <div key={label}>
                  <div className="flex justify-between text-xs font-bold mb-1">
                    <span className={text}>{label}</span>
                    <span>{count} ({Math.round((count / totalLabTests) * 100)}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-dark-surface overflow-hidden">
                    <div style={{ width: `${(count / totalLabTests) * 100}%` }} className={`h-full ${bar} rounded-full`} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Patient population and encounters */}
        <div className="p-6 rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-3">
            <div className="flex items-center space-x-2">
              <Users className="w-4 h-4 text-blue-500" />
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-white">
                Patient Population &amp; Gender Demographics
              </h3>
            </div>
            <span className="text-xs text-slate-400 font-bold">{patients.length} Registered</span>
          </div>

          <p className="text-[10px] text-slate-400 -mt-2">
            The registered total is all-time and does not change with the range; the encounter figures below do.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/50 text-center">
              <span className="text-2xl font-black text-blue-700 dark:text-blue-300">{maleCount}</span>
              <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-1">Male Patients</div>
              <span className="text-[10px] text-slate-400">{Math.round((maleCount / (patients.length || 1)) * 100)}% of cohort</span>
            </div>
            <div className="p-4 rounded-2xl bg-pink-50/50 dark:bg-pink-950/20 border border-pink-200 dark:border-pink-900/50 text-center">
              <span className="text-2xl font-black text-pink-700 dark:text-pink-300">{femaleCount}</span>
              <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-1">Female Patients</div>
              <span className="text-[10px] text-slate-400">{Math.round((femaleCount / (patients.length || 1)) * 100)}% of cohort</span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-dark-surface/50 border border-light-border dark:border-dark-border text-xs space-y-2">
            <div className="font-bold text-slate-800 dark:text-slate-200">Encounters in this range:</div>
            <div className="flex justify-between text-slate-500">
              <span>Clinical Visits Logged:</span>
              <strong className="text-slate-800 dark:text-slate-200">{visits.length} encounters</strong>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Average Encounters per Patient:</span>
              <strong className="text-emerald-600">{(visits.length / (patients.length || 1)).toFixed(1)} visits</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/** Says what is refused and who to ask, instead of showing a locked icon and nothing. */
const RevenueRefused: React.FC = () => (
  <div className="p-6 rounded-3xl bg-white dark:bg-dark-card border border-dashed border-amber-300 dark:border-amber-900 flex items-start gap-3">
    <Lock className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
    <div>
      <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">
        Revenue is not shown on this account
      </h3>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
        What the clinic earns and what patients owe is limited to Administrator, Front Desk and
        Billing Officer. The clinical figures on this page are unaffected.
      </p>
    </div>
  </div>
);

/** An empty range is a fact about the dates, not an error, so it says which range. */
const EmptyRange: React.FC<{ what: string }> = ({ what }) => (
  <div className="py-6 text-center">
    <p className="text-xs font-bold text-slate-600 dark:text-slate-300">No {what} in this range</p>
    <p className="text-[11px] text-slate-400 mt-1">Widen the dates above to see earlier activity.</p>
  </div>
);