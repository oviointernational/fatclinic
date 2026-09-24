import React, { useState } from 'react';
import { db } from '../../services/db';
import { useAuth } from '../../context/AuthContext';
import { useSyncDb } from '../../hooks/useSyncDb';
import { Medication } from '../../types';
import { AlertTriangle, CheckCircle2, Package, X } from 'lucide-react';

/**
 * Pharmacy Stock Requests — drug reorder requests unique to the dispensary.
 * Raise a request per low medication; approving / dispatching fulfils it and
 * adds the quantity back into formulary stock.
 */
export const MedicationRequestsPanel: React.FC = () => {
  const { currentUser } = useAuth();
  useSyncDb();

  const [requestMed, setRequestMed] = useState<Medication | null>(null);
  const [requestQty, setRequestQty] = useState(100);
  const [requestUrgency, setRequestUrgency] = useState<'Routine' | 'Urgent'>('Routine');
  const [notice, setNotice] = useState<string | null>(null);

  const medications = db.getMedications();
  const requests = db.getMedicationRequests();
  const lowMeds = medications.filter(m => m.currentStock <= m.minStockAlert);
  const pending = requests.filter(r => r.status === 'Pending').length;

  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  };

  const handleRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestMed || requestQty <= 0) return;
    db.requestMedicationRestock(requestMed.id, requestQty, requestUrgency, currentUser);
    showNotice(`Restock request sent: ${requestQty} x ${requestMed.name} (${requestUrgency}).`);
    setRequestMed(null);
    setRequestQty(100);
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
      {notice && (
        <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 text-[11px] font-bold text-emerald-700 flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Low-stock reorder panel */}
      <div className="rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b border-light-border dark:border-dark-border bg-slate-50 dark:bg-dark-surface/60 flex items-center justify-between">
          <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-rose-500" />
            <span>Low-Stock Drugs Needing Reorder ({lowMeds.length})</span>
          </span>
        </div>
        {lowMeds.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400">All formulary stock levels are healthy.</div>
        ) : (
          <div className="divide-y divide-light-border/60 dark:divide-dark-border/60">
            {lowMeds.map(m => (
              <div key={m.id} className="px-4 py-2.5 flex items-center justify-between gap-2 text-xs">
                <div>
                  <div className="font-bold text-slate-800 dark:text-slate-100">{m.name} <span className="font-normal text-slate-400">({m.strength})</span></div>
                  <div className="text-[11px] text-slate-500">
                    <strong className="text-rose-600">{m.currentStock}</strong> in stock • threshold {m.minStockAlert} • {m.category}
                  </div>
                </div>
                <button
                  onClick={() => { setRequestMed(m); setRequestQty(Math.max(50, m.minStockAlert * 4)); }}
                  className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-amber-500 hover:bg-amber-600 text-white flex-shrink-0"
                >
                  Request Restock
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Requests ledger */}
      <div className="rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b border-light-border dark:border-dark-border bg-slate-50 dark:bg-dark-surface/60 flex items-center justify-between">
          <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center space-x-2">
            <Package className="w-4 h-4 text-purple-500" />
            <span>Reorder Requests ({requests.length})</span>
          </span>
          {pending > 0 && (
            <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">{pending} Pending</span>
          )}
        </div>
        {requests.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400">No reorder requests yet — raise one from a low-stock drug above.</div>
        ) : (
          <div className="divide-y divide-light-border/60 dark:divide-dark-border/60 max-h-[320px] overflow-y-auto">
            {requests.map(r => (
              <div key={r.id} className="px-4 py-2.5 flex items-center justify-between gap-2 text-xs">
                <div>
                  <div className="font-bold text-slate-800 dark:text-slate-100">{r.quantityRequested} x {r.medicationName}</div>
                  <div className="text-[11px] text-slate-500">{r.requestedBy} • {new Date(r.requestedAt).toLocaleString()} • {r.urgency}</div>
                </div>
                <div className="flex items-center space-x-1.5 flex-shrink-0">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.status === 'Pending' ? 'bg-amber-100 text-amber-800' : r.status === 'Approved' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'}`}>
                    {r.status}
                  </span>
                  {r.status === 'Pending' && (
                    <button
                      onClick={() => { db.updateMedicationRequestStatus(r.id, 'Approved', currentUser); showNotice(`Approved: ${r.medicationName}`); }}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      Approve
                    </button>
                  )}
                  {r.status !== 'Dispatched' && (
                    <button
                      onClick={() => { db.updateMedicationRequestStatus(r.id, 'Dispatched', currentUser); showNotice(`Dispatched — stock updated for ${r.medicationName}`); }}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      Dispatch
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {requestMed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <form onSubmit={handleRequest} className="bg-white dark:bg-dark-card rounded-2xl border shadow-2xl p-5 w-full max-w-sm space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <h4 className="font-extrabold text-sm">Request Restock — {requestMed.name}</h4>
              <button type="button" onClick={() => setRequestMed(null)} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-slate-500">In stock: <strong>{requestMed.currentStock}</strong> • threshold {requestMed.minStockAlert} {requestMed.dispensingUnit}s.</p>
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
              <button type="button" onClick={() => setRequestMed(null)} className="px-4 py-2 rounded-xl border font-bold">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold">Send Request</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
