import React, { useState } from 'react';
import { db } from '../../services/db';
import { useAuth } from '../../context/AuthContext';
import { useSyncDb } from '../../hooks/useSyncDb';
import { ClinicalConsumable } from '../../types';
import { AlertTriangle, CheckCircle2, Package, Search, X } from 'lucide-react';

interface SectionConsumablesPanelProps {
  section: ClinicalConsumable['category'];
  title?: string;
  subtitle?: string;
  accentClass?: string;
}

/**
 * Harmonized per-section consumables view.
 * - Shows only this section's consumables (by category) + General items.
 * - Any section can Request restock or Log usage; usage subtracts from stock.
 * - Optional patient linkage posts the charge to that visit's invoice.
 * - Prices are read-only here: only Administration can change prices.
 */
export const SectionConsumablesPanel: React.FC<SectionConsumablesPanelProps> = ({
  section,
  title,
  subtitle,
  accentClass = 'bg-emerald-600 hover:bg-emerald-700',
}) => {
  const { currentUser } = useAuth();
  useSyncDb();
  const [search, setSearch] = useState('');
  const [usageItem, setUsageItem] = useState<ClinicalConsumable | null>(null);
  const [usageQty, setUsageQty] = useState(1);
  const [usagePatientId, setUsagePatientId] = useState('');
  const [requestItem, setRequestItem] = useState<ClinicalConsumable | null>(null);
  const [requestQty, setRequestQty] = useState(10);
  const [requestUrgency, setRequestUrgency] = useState<'Routine' | 'Urgent'>('Routine');
  const [notice, setNotice] = useState<string | null>(null);

  const settings = db.getSettings();
  const all = db.getClinicalConsumables();
  const items = all.filter(
    c =>
      (c.category === section || c.category === 'General') &&
      (c.name.toLowerCase().includes(search.toLowerCase()) || c.id.toLowerCase().includes(search.toLowerCase()))
  );
  const lowCount = items.filter(c => c.currentStock <= c.minAlertLevel).length;

  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  };

  const handleLogUsage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!usageItem || usageQty <= 0) return;
    try {
      let patientId: string | undefined;
      let visitId: string | undefined;
      const q = usagePatientId.trim();
      if (q) {
        const found =
          db.getPatientById(q) ||
          db.searchPatients(q)[0];
        if (found) {
          patientId = found.id;
          visitId = db.getVisits(found.id)[0]?.id;
        }
      }
      db.logConsumableUsage(usageItem.id, usageQty, currentUser, {
        section,
        patientId,
        visitId,
      });
      showNotice(
        `Logged ${usageQty} x ${usageItem.name}${patientId ? ` — billed to ${patientId}` : ''}. Stock subtracted.`
      );
      setUsageItem(null);
      setUsageQty(1);
      setUsagePatientId('');
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestItem || requestQty <= 0) return;
    db.requestConsumableRestock(requestItem.id, requestQty, requestUrgency, currentUser, section);
    showNotice(`Restock request sent to Administration: ${requestQty} x ${requestItem.name} (${requestUrgency}).`);
    setRequestItem(null);
    setRequestQty(10);
  };

  return (
    <div className="rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-light-border dark:border-dark-border flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center space-x-2">
            <Package className="w-4 h-4 text-emerald-600" />
            <span>{title || `${section} Consumables`}</span>
            {lowCount > 0 && (
              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 animate-pulse">
                {lowCount} low stock
              </span>
            )}
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {subtitle || `Only ${section} + General items shown here. Prices are set by Administration (read-only). Log usage to subtract stock and bill the patient.`}
          </p>
        </div>
        <div className="relative w-56">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search consumables..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
      </div>

      {notice && (
        <div className="mx-3 mt-3 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 text-[11px] font-bold text-emerald-700 flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-dark-surface/60 text-slate-500 uppercase text-[10px] font-extrabold">
            <tr>
              <th className="py-2.5 px-4">Item</th>
              <th className="py-2.5 px-4 text-center">Stock</th>
              <th className="py-2.5 px-4 text-right">Charge</th>
              <th className="py-2.5 px-4 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-light-border/60 dark:divide-dark-border/60">
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center py-6 text-slate-400 text-xs">
                  No {section} consumables yet — ask Administration to add items under Clinical Consumables.
                </td>
              </tr>
            )}
            {items.map(c => {
              const isLow = c.currentStock <= c.minAlertLevel;
              return (
                <tr key={c.id} className="hover:bg-slate-50/60">
                  <td className="py-2.5 px-4">
                    <div className="font-bold text-slate-800 dark:text-slate-100">{c.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{c.id} • {c.unit}</div>
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${isLow ? 'bg-rose-100 text-rose-700 animate-pulse' : 'bg-emerald-50 text-emerald-700'}`}>
                      {c.currentStock}
                    </span>
                    {isLow && (
                      <span className="ml-1 inline-flex items-center text-[10px] text-rose-500 font-bold">
                        <AlertTriangle className="w-3 h-3" />
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-right font-extrabold text-slate-800 dark:text-slate-200">
                    {settings.currency}{c.unitPrice.toLocaleString()}
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    <div className="flex items-center justify-center space-x-1.5">
                      <button
                        onClick={() => { setUsageItem(c); setUsageQty(1); }}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold text-white ${accentClass}`}
                      >
                        Log Usage
                      </button>
                      <button
                        onClick={() => { setRequestItem(c); setRequestQty(10); }}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700"
                      >
                        Request
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {usageItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <form onSubmit={handleLogUsage} className="bg-white dark:bg-dark-card rounded-2xl border shadow-2xl p-5 w-full max-w-sm space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <h4 className="font-extrabold text-sm">Log Usage — {usageItem.name}</h4>
              <button type="button" onClick={() => setUsageItem(null)} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-slate-500">In stock: <strong>{usageItem.currentStock} {usageItem.unit}</strong>. Stock is subtracted immediately{usagePatientId.trim() ? ' and billed to the patient visit' : ''}.</p>
            <div>
              <label className="block font-bold mb-1">Quantity used:</label>
              <input type="number" min={1} max={usageItem.currentStock} value={usageQty} onChange={e => setUsageQty(Math.max(1, Number(e.target.value)))} className="w-full px-3 py-2 rounded-xl bg-slate-50 border font-bold" />
            </div>
            <div>
              <label className="block font-bold mb-1">Patient (optional — bill this usage):</label>
              <input value={usagePatientId} onChange={e => setUsagePatientId(e.target.value)} placeholder="Hospital no / name / phone (leave blank for ward use)" className="w-full px-3 py-2 rounded-xl bg-slate-50 border text-xs" />
            </div>
            <div className="flex justify-end space-x-2">
              <button type="button" onClick={() => setUsageItem(null)} className="px-4 py-2 rounded-xl border font-bold">Cancel</button>
              <button type="submit" className={`px-4 py-2 rounded-xl text-white font-bold ${accentClass}`}>Confirm Usage</button>
            </div>
          </form>
        </div>
      )}

      {requestItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <form onSubmit={handleRequest} className="bg-white dark:bg-dark-card rounded-2xl border shadow-2xl p-5 w-full max-w-sm space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <h4 className="font-extrabold text-sm">Request Restock — {requestItem.name}</h4>
              <button type="button" onClick={() => setRequestItem(null)} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div>
              <label className="block font-bold mb-1">Quantity needed:</label>
              <input type="number" min={1} value={requestQty} onChange={e => setRequestQty(Math.max(1, Number(e.target.value)))} className="w-full px-3 py-2 rounded-xl bg-slate-50 border font-bold" />
            </div>
            <div>
              <label className="block font-bold mb-1">Urgency:</label>
              <select value={requestUrgency} onChange={e => setRequestUrgency(e.target.value as any)} className="w-full px-3 py-2 rounded-xl bg-slate-50 border font-bold">
                <option value="Routine">Routine</option>
                <option value="Urgent">Urgent</option>
              </select>
            </div>
            <div className="flex justify-end space-x-2">
              <button type="button" onClick={() => setRequestItem(null)} className="px-4 py-2 rounded-xl border font-bold">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold">Send to Admin</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
