import React from 'react';
import { db } from '../../services/db';
import { useSyncDb } from '../../hooks/useSyncDb';
import {
  Pill,
  Package,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Coins,
  ArrowRight
} from 'lucide-react';

interface PharmacyOverviewProps {
  onNavigateQueue?: () => void;
  onNavigateInventory?: () => void;
}

export const PharmacyOverview: React.FC<PharmacyOverviewProps> = ({
  onNavigateQueue,
  onNavigateInventory
}) => {
  useSyncDb();

  const prescriptions = db.getPrescriptions();
  const medications = db.getMedications();
  const settings = db.getSettings();

  const allRxItems = prescriptions.flatMap(p => p.items);
  const pendingDispense = allRxItems.filter(i => i.dispenseStatus === 'Pending').length;
  const completedDispense = allRxItems.filter(i => i.dispenseStatus === 'Dispensed').length;
  const lowStockMeds = medications.filter(m => m.currentStock <= m.minStockAlert);
  const totalStockValue = medications.reduce((sum, m) => sum + (m.currentStock * m.unitPrice), 0);

  return (
    <div className="h-full flex flex-col select-text overflow-y-auto p-6 space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Pending Dispense</span>
            <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
            {pendingDispense}
          </div>
          <span className="text-[10px] text-slate-400">Prescription items in queue</span>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Dispensed Items</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
            {completedDispense}
          </div>
          <span className="text-[10px] text-slate-400">Handed over to patients</span>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Low Stock Reorders</span>
            <div className="w-8 h-8 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-rose-600 dark:text-rose-400 mt-1">
            {lowStockMeds.length}
          </div>
          <span className="text-[10px] text-slate-400">At or below reorder limit</span>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Formulary Value</span>
            <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Coins className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
            {settings.currency}{totalStockValue.toLocaleString()}
          </div>
          <span className="text-[10px] text-slate-400">{medications.length} drug formulations</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-5 rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-3">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-rose-600 dark:text-rose-400 flex items-center space-x-1.5">
              <AlertTriangle className="w-4 h-4" />
              <span>Low Inventory Formulary Warnings</span>
            </h3>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">
              {lowStockMeds.length} Items Critical
            </span>
          </div>

          <div className="space-y-2">
            {lowStockMeds.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400">All drug stock levels are healthy.</div>
            ) : (
              lowStockMeds.map(med => (
                <div key={med.id} className="p-3 rounded-xl bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/50 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-extrabold text-slate-900 dark:text-white">{med.name} ({med.strength})</div>
                    <div className="text-[11px] text-slate-500">{med.category} • Unit: {settings.currency}{med.unitPrice}</div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-black px-2 py-1 rounded bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300">
                      {med.currentStock} in stock
                    </span>
                    <div className="text-[10px] text-slate-400 mt-0.5">Threshold: {med.minStockAlert}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="p-5 rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-4">
          <div className="border-b border-light-border dark:border-dark-border pb-3">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Pharmacy Workflows &amp; Actions
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div 
              onClick={onNavigateQueue}
              className="p-4 rounded-2xl bg-slate-50 dark:bg-dark-surface hover:bg-blue-50 dark:hover:bg-blue-950/40 border border-light-border dark:border-dark-border cursor-pointer transition-all flex flex-col justify-between"
            >
              <div>
                <Pill className="w-5 h-5 text-blue-600 mb-2" />
                <div className="font-extrabold text-xs text-slate-900 dark:text-white">Active Dispensing Queue</div>
                <p className="text-[11px] text-slate-400 mt-1">Review physician prescriptions, label dosage, and dispense drugs.</p>
              </div>
              <span className="text-xs font-bold text-blue-600 dark:text-blue-400 mt-3 inline-flex items-center space-x-1">
                <span>Open Queue</span>
                <ArrowRight className="w-3 h-3" />
              </span>
            </div>

            <div 
              onClick={onNavigateInventory}
              className="p-4 rounded-2xl bg-slate-50 dark:bg-dark-surface hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border border-light-border dark:border-dark-border cursor-pointer transition-all flex flex-col justify-between"
            >
              <div>
                <Package className="w-5 h-5 text-emerald-600 mb-2" />
                <div className="font-extrabold text-xs text-slate-900 dark:text-white">Formulary &amp; Stock Reorders</div>
                <p className="text-[11px] text-slate-400 mt-1">Update shelf stock quantities, adjust retail pricing, and order new batches.</p>
              </div>
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mt-3 inline-flex items-center space-x-1">
                <span>View Inventory</span>
                <ArrowRight className="w-3 h-3" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
