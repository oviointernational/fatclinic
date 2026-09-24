import React from 'react';
import { db } from '../../services/db';
import { useSyncDb } from '../../hooks/useSyncDb';
import {
  HeartPulse,
  Clock,
  Activity,
  CheckCircle2,
  Package,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';

interface PhysiotherapyOverviewProps {
  onNavigateCategory?: (category: string) => void;
  onNavigateSessions?: () => void;
  onNavigateEquipment?: () => void;
}

export const PhysiotherapyOverview: React.FC<PhysiotherapyOverviewProps> = ({
  onNavigateCategory,
  onNavigateSessions,
  onNavigateEquipment,
}) => {
  useSyncDb();
  const orders = db.getPhysiotherapyOrders();
  const settings = db.getSettings();

  const requested = orders.filter(o => o.status === 'Requested').length;
  const active = orders.filter(o => o.status === 'In Progress').length;
  const completed = orders.filter(o => o.status === 'Completed').length;
  const sessionsDone = orders.reduce((s, o) => s + (o.sessionsCompleted || 0), 0);
  const revenue = orders.reduce((s, o) => s + o.price, 0);

  const categories = ['Musculoskeletal', 'Neurological', 'Sports', 'Pediatric', 'General'].map(c => ({
    name: c,
    n: orders.filter(o => o.category === c).length,
  }));
  const maxCat = Math.max(1, ...categories.map(x => x.n));

  const supplies = db.getClinicalConsumables().filter(c => c.category === 'Physiotherapy');
  const lowSupplies = supplies.filter(c => c.currentStock <= c.minAlertLevel);

  return (
    <div className="h-full flex flex-col select-text overflow-y-auto p-6 space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Requested Orders', value: requested, sub: 'Awaiting first session', icon: <Clock className="w-4 h-4" />, box: 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400' },
          { label: 'Therapies Active', value: active, sub: 'Sessions in progress', icon: <Activity className="w-4 h-4" />, box: 'bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400' },
          { label: 'Completed Rehab', value: completed, sub: `${sessionsDone} sessions delivered`, icon: <CheckCircle2 className="w-4 h-4" />, box: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400' },
          { label: 'Rehab Revenue', value: `${settings.currency}${revenue.toLocaleString()}`, sub: `${orders.length} orders billed`, icon: <HeartPulse className="w-4 h-4" />, box: 'bg-teal-100 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400' },
        ].map(s => (
          <div key={s.label} className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{s.label}</span>
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${s.box}`}>{s.icon}</div>
            </div>
            <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">{s.value}</div>
            <span className="text-[10px] text-slate-400">{s.sub}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-5 rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-3">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-white">
              Orders by Therapy Category
            </h3>
            {onNavigateSessions && (
              <button onClick={onNavigateSessions} className="text-xs font-bold text-teal-600 hover:text-teal-700 flex items-center space-x-1">
                <span>Ongoing Sessions</span><ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
          {categories.map(c => (
            <div
              key={c.name}
              onClick={() => onNavigateCategory && onNavigateCategory(c.name)}
              className="cursor-pointer hover:bg-slate-50 dark:hover:bg-dark-surface/40 rounded-xl p-1.5 transition-all"
            >
              <div className="flex justify-between text-xs font-bold mb-1">
                <span className="text-teal-600 dark:text-teal-400">{c.name}</span>
                <span>{c.n} order(s)</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 dark:bg-dark-surface overflow-hidden">
                <div style={{ width: `${(c.n / maxCat) * 100}%` }} className="h-full bg-teal-500 rounded-full" />
              </div>
            </div>
          ))}
        </div>

        <div className="p-5 rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-3">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-white flex items-center space-x-1.5">
              <Package className="w-4 h-4 text-teal-500" />
              <span>Rehab Supplies & Equipment</span>
            </h3>
            {onNavigateEquipment && (
              <button onClick={onNavigateEquipment} className="text-xs font-bold text-teal-600 hover:text-teal-700 flex items-center space-x-1">
                <span>Manage Supplies</span><ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
          {supplies.length === 0 && <div className="text-xs text-slate-400 text-center p-4">No physiotherapy consumables registered.</div>}
          {supplies.map(c => (
            <div key={c.id} className="p-3 rounded-xl bg-slate-50 dark:bg-dark-surface/50 border border-light-border dark:border-dark-border flex items-center justify-between text-xs">
              <div>
                <div className="font-bold text-slate-900 dark:text-white">{c.name}</div>
                <div className="text-[11px] text-slate-500">Stock: <strong>{c.currentStock} {c.unit}</strong></div>
              </div>
              {c.currentStock <= c.minAlertLevel ? (
                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-100 text-rose-700 animate-pulse">
                  <AlertTriangle className="w-3 h-3" /><span>Low Stock</span>
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">Adequate</span>
              )}
            </div>
          ))}
          {lowSupplies.length > 0 && (
            <p className="text-[11px] font-bold text-rose-600">{lowSupplies.length} item(s) need restocking — raise requests from the Equipment tab.</p>
          )}
        </div>
      </div>
    </div>
  );
};
