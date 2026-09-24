import React, { useState } from 'react';
import { db } from '../../services/db';
import {
  Users,
  FlaskConical
} from 'lucide-react';

export const AnalyticsDashboard: React.FC = () => {
  const [dateFilter, setDateFilter] = useState<'today' | 'week' | 'month' | 'year'>('month');

  const patients = db.getPatients();
  const visits = db.getVisits();
  const labRequests = db.getLabRequests();
  const prescriptions = db.getPrescriptions();
  const invoices = db.getInvoices();
  const settings = db.getSettings();

  // 1. Departmental Revenue Breakdown
  let revConsult = 0;
  let revLab = 0;
  let revRx = 0;
  let revNurse = 0;

  invoices.forEach(inv => {
    inv.items.forEach(it => {
      if (it.serviceCategory === 'Consultation') revConsult += it.totalPrice;
      else if (it.serviceCategory === 'Laboratory') revLab += it.totalPrice;
      else if (it.serviceCategory === 'Pharmacy') revRx += it.totalPrice;
      else revNurse += it.totalPrice;
    });
  });

  const grandRevenue = revConsult + revLab + revRx + revNurse;

  // 2. 4 Laboratory Categories Breakdown
  let countHem = 0;
  let countMic = 0;
  let countChe = 0;
  let countHis = 0;

  labRequests.forEach(r => {
    r.tests.forEach(t => {
      if (t.category === 'HEMATOLOGY') countHem++;
      else if (t.category === 'MICROBIOLOGY') countMic++;
      else if (t.category === 'CHEMICAL_PATHOLOGY') countChe++;
      else countHis++;
    });
  });

  const totalLabTests = countHem + countMic + countChe + countHis || 1;

  // 3. Gender Demographics
  const maleCount = patients.filter(p => p.sex === 'Male').length;
  const femaleCount = patients.filter(p => p.sex === 'Female').length;

  return (
    <div className="h-full flex flex-col select-text overflow-y-auto p-6 space-y-6">
      {/* Compact control bar: context + date range */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex-shrink-0">
        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 px-1">
          Analytics • {dateFilter === 'today' ? 'Today' : `This ${dateFilter}`}
        </span>

        {/* Date Range Selector */}
        <div className="flex items-center space-x-1.5 bg-slate-100 dark:bg-dark-surface p-1 rounded-xl text-xs font-bold">
          {(['today', 'week', 'month', 'year'] as const).map(period => (
            <button
              key={period}
              onClick={() => setDateFilter(period)}
              className={`px-3 py-1.5 rounded-xl capitalize transition-all ${
                dateFilter === period
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {period === 'today' ? 'Today' : `This ${period}`}
            </button>
          ))}
        </div>
      </div>

      {/* Financial Breakdown Card */}
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

        {/* Visual Stacked Progress Bar */}
        <div className="h-4 w-full rounded-full bg-slate-100 dark:bg-dark-surface flex overflow-hidden">
          <div style={{ width: `${(revConsult / grandRevenue) * 100 || 25}%` }} className="bg-rose-500" title="Consultation" />
          <div style={{ width: `${(revLab / grandRevenue) * 100 || 25}%` }} className="bg-amber-500" title="Laboratory" />
          <div style={{ width: `${(revRx / grandRevenue) * 100 || 25}%` }} className="bg-purple-500" title="Pharmacy" />
          <div style={{ width: `${(revNurse / grandRevenue) * 100 || 25}%` }} className="bg-teal-500" title="Nursing & Procedures" />
        </div>

        {/* Legend */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs pt-2">
          <div className="p-3 rounded-2xl bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/50">
            <span className="text-[10px] font-bold text-rose-600 uppercase">Consultations</span>
            <div className="text-base font-extrabold text-slate-900 dark:text-white mt-1">
              {settings.currency}{revConsult.toLocaleString()}
            </div>
            <span className="text-[10px] text-slate-400 font-semibold">{Math.round((revConsult / grandRevenue) * 100 || 0)}% of total</span>
          </div>

          <div className="p-3 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50">
            <span className="text-[10px] font-bold text-amber-600 uppercase">Laboratory</span>
            <div className="text-base font-extrabold text-slate-900 dark:text-white mt-1">
              {settings.currency}{revLab.toLocaleString()}
            </div>
            <span className="text-[10px] text-slate-400 font-semibold">{Math.round((revLab / grandRevenue) * 100 || 0)}% of total</span>
          </div>

          <div className="p-3 rounded-2xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/50">
            <span className="text-[10px] font-bold text-purple-600 uppercase">Pharmacy</span>
            <div className="text-base font-extrabold text-slate-900 dark:text-white mt-1">
              {settings.currency}{revRx.toLocaleString()}
            </div>
            <span className="text-[10px] text-slate-400 font-semibold">{Math.round((revRx / grandRevenue) * 100 || 0)}% of total</span>
          </div>

          <div className="p-3 rounded-2xl bg-teal-50/50 dark:bg-teal-950/20 border border-teal-200 dark:border-teal-900/50">
            <span className="text-[10px] font-bold text-teal-600 uppercase">Nursing / Procedures</span>
            <div className="text-base font-extrabold text-slate-900 dark:text-white mt-1">
              {settings.currency}{revNurse.toLocaleString()}
            </div>
            <span className="text-[10px] text-slate-400 font-semibold">{Math.round((revNurse / grandRevenue) * 100 || 0)}% of total</span>
          </div>
        </div>
      </div>

      {/* Grid: Lab Categories & Demographics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Laboratory 4 Category Breakdown */}
        <div className="p-6 rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-3">
            <div className="flex items-center space-x-2">
              <FlaskConical className="w-4 h-4 text-amber-500" />
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-white">
                Pathology Workload by 4 Mandatory Categories
              </h3>
            </div>
            <span className="text-xs text-slate-400 font-bold">{totalLabTests} Total Ordered</span>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs font-bold mb-1">
                <span className="text-rose-600">1. Hematology (FBC, ESR, Coagulation)</span>
                <span>{countHem} ({Math.round((countHem / totalLabTests) * 100)}%)</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 dark:bg-dark-surface overflow-hidden">
                <div style={{ width: `${(countHem / totalLabTests) * 100}%` }} className="h-full bg-rose-500 rounded-full" />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-bold mb-1">
                <span className="text-amber-600">2. Medical Microbiology (MP, Urine, Stool, Culture)</span>
                <span>{countMic} ({Math.round((countMic / totalLabTests) * 100)}%)</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 dark:bg-dark-surface overflow-hidden">
                <div style={{ width: `${(countMic / totalLabTests) * 100}%` }} className="h-full bg-amber-500 rounded-full" />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-bold mb-1">
                <span className="text-teal-600">3. Chemical Pathology (LFT, U&E, HbA1c, Lipids)</span>
                <span>{countChe} ({Math.round((countChe / totalLabTests) * 100)}%)</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 dark:bg-dark-surface overflow-hidden">
                <div style={{ width: `${(countChe / totalLabTests) * 100}%` }} className="h-full bg-teal-500 rounded-full" />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-bold mb-1">
                <span className="text-purple-600">4. Histopathology (Biopsy, Cytology, Pap Smear)</span>
                <span>{countHis} ({Math.round((countHis / totalLabTests) * 100)}%)</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 dark:bg-dark-surface overflow-hidden">
                <div style={{ width: `${(countHis / totalLabTests) * 100}%` }} className="h-full bg-purple-500 rounded-full" />
              </div>
            </div>
          </div>
        </div>

        {/* Patient Demographics & Encounters */}
        <div className="p-6 rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-3">
            <div className="flex items-center space-x-2">
              <Users className="w-4 h-4 text-blue-500" />
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-white">
                Patient Population & Gender Demographics
              </h3>
            </div>
            <span className="text-xs text-slate-400 font-bold">{patients.length} Registered</span>
          </div>

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
            <div className="font-bold text-slate-800 dark:text-slate-200">Encounter Retention:</div>
            <div className="flex justify-between text-slate-500">
              <span>Total Clinical Visits Logged:</span>
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
