import React from 'react';
import { db } from '../../services/db';
import { useSyncDb } from '../../hooks/useSyncDb';
import {
  Radio,
  Clock,
  CheckCircle2,
  FileCheck2,
  Package,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';

interface RadiologyOverviewProps {
  onNavigateModality?: (modality: string) => void;
  onNavigateStock?: () => void;
  onNavigateReports?: () => void;
}

export const RadiologyOverview: React.FC<RadiologyOverviewProps> = ({
  onNavigateModality,
  onNavigateStock,
  onNavigateReports,
}) => {
  useSyncDb();
  const orders = db.getRadiologyOrders();
  const settings = db.getSettings();

  const requested = orders.filter(o => o.status === 'Requested').length;
  const completed = orders.filter(o => o.status === 'Completed').length;
  const reported = orders.filter(o => o.status === 'Report Ready').length;
  const revenue = orders.reduce((s, o) => s + o.price, 0);

  const modalities = ['X-Ray', 'Ultrasound', 'CT Scan', 'MRI', 'Echocardiogram'].map(m => ({
    name: m,
    n: orders.filter(o => o.modality === m).length,
  }));
  const maxMod = Math.max(1, ...modalities.map(x => x.n));

  const films = db.getClinicalConsumables().filter(c => c.category === 'Radiology');
  const lowFilms = films.filter(c => c.currentStock <= c.minAlertLevel);

  return (
    <div className="h-full flex flex-col select-text overflow-y-auto p-6 space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Requested Scans', value: requested, sub: 'Awaiting imaging', icon: <Clock className="w-4 h-4" />, box: 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400' },
          { label: 'Imaging Completed', value: completed, sub: 'Awaiting PACS report', icon: <Radio className="w-4 h-4" />, box: 'bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400' },
          { label: 'Reports Ready', value: reported, sub: 'Released to physicians', icon: <FileCheck2 className="w-4 h-4" />, box: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400' },
          { label: 'Imaging Revenue', value: `${settings.currency}${revenue.toLocaleString()}`, sub: `${orders.length} orders billed`, icon: <CheckCircle2 className="w-4 h-4" />, box: 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400' },
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
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-white border-b border-light-border dark:border-dark-border pb-3">
            Orders by Modality
          </h3>
          {modalities.map(m => (
            <div
              key={m.name}
              onClick={() => onNavigateModality && onNavigateModality(m.name)}
              className="cursor-pointer hover:bg-slate-50 dark:hover:bg-dark-surface/40 rounded-xl p-1.5 transition-all"
            >
              <div className="flex justify-between text-xs font-bold mb-1">
                <span className="text-indigo-600 dark:text-indigo-400">{m.name}</span>
                <span>{m.n} order(s)</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 dark:bg-dark-surface overflow-hidden">
                <div style={{ width: `${(m.n / maxMod) * 100}%` }} className="h-full bg-indigo-500 rounded-full" />
              </div>
            </div>
          ))}
        </div>

        <div className="p-5 rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-3">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-white flex items-center space-x-1.5">
              <Package className="w-4 h-4 text-indigo-500" />
              <span>Films & Imaging Consumables</span>
            </h3>
            {onNavigateStock && (
              <button onClick={onNavigateStock} className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center space-x-1">
                <span>Manage Stock</span><ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
          {films.length === 0 && <div className="text-xs text-slate-400 text-center p-4">No radiology consumables registered.</div>}
          {films.map(c => (
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
          {lowFilms.length > 0 && onNavigateReports && (
            <button onClick={onNavigateReports} className="text-xs font-bold text-emerald-600 hover:text-emerald-700">
              View completed PACS reports →
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
