import React, { useState } from 'react';
import { Prescription, PrescriptionItem, Medication } from '../../types';
import { SectionConsumablesPanel } from '../common/SectionConsumablesPanel';
import { MedicationRequestsPanel } from './MedicationRequestsPanel';
import { db } from '../../services/db';
import { useCurrentUser } from '../../context/AuthContext';
import { useSyncDb } from '../../hooks/useSyncDb';
import {
  Package,
  CheckCircle2,
  AlertTriangle,
  Search,
  X
} from 'lucide-react';

interface PharmacyDashboardProps {
  initialTab?: 'queue' | 'inventory' | 'consumables' | 'dispensed' | 'requests';
}

type PharmacyTab = 'queue' | 'inventory' | 'consumables' | 'dispensed' | 'requests';

export const PharmacyDashboard: React.FC<PharmacyDashboardProps> = ({
  initialTab = 'queue',
}) => {
  const currentUser = useCurrentUser();
  useSyncDb();
  const [activeTab, setActiveTab] = useState<PharmacyTab>(initialTab);
  const [search, setSearch] = useState('');

  React.useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  // Dispensing state modal (single item)
  const [selectedRx, setSelectedRx] = useState<Prescription | null>(null);
  const [dispenseItem, setDispenseItem] = useState<PrescriptionItem | null>(null);
  const [dispenseQty, setDispenseQty] = useState<number>(0);
  const [pharmacistNotes, setPharmacistNotes] = useState<string>('');

  // Patient prescriptions dialog + batch dispense
  const [dialogPatientId, setDialogPatientId] = useState<string | null>(null);
  const [checkedKeys, setCheckedKeys] = useState<string[]>([]);
  const [batchNotes, setBatchNotes] = useState('');

  // Dispensed list filters
  const [dispFrom, setDispFrom] = useState('');
  const [dispTo, setDispTo] = useState('');
  const [dispSort, setDispSort] = useState<'newest' | 'oldest'>('newest');

  const prescriptions = db.getPrescriptions();
  const medications = db.getMedications();
  const settings = db.getSettings();

  const handleOpenDispense = (rx: Prescription, item: PrescriptionItem) => {
    setSelectedRx(rx);
    setDispenseItem(item);
    setDispenseQty(item.quantityPrescribed - item.quantityDispensed);
    setPharmacistNotes('');
  };

  const handleConfirmDispense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRx || !dispenseItem || dispenseQty <= 0) return;

    db.dispensePrescriptionItem(
      selectedRx.id,
      dispenseItem.id,
      Number(dispenseQty),
      pharmacistNotes,
      currentUser
    );

    setSelectedRx(null);
    setDispenseItem(null);
  };

  // Patients that have prescriptions, with queue aggregates
  const queuePatients = React.useMemo(() => {
    const map = new Map<string, { rxs: Prescription[]; pendingItems: number; total: number }>();
    prescriptions.forEach(rx => {
      const entry = map.get(rx.patientId) || { rxs: [], pendingItems: 0, total: 0 };
      entry.rxs.push(rx);
      entry.pendingItems += rx.items.filter(i => i.dispenseStatus !== 'Dispensed').length;
      entry.total += rx.totalPrice;
      map.set(rx.patientId, entry);
    });
    return [...map.entries()]
      .map(([patientId, data]) => ({ patientId, patient: db.getPatientById(patientId), ...data }))
      .filter(r => {
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return (
          r.patientId.toLowerCase().includes(q) ||
          (r.patient && `${r.patient.firstName} ${r.patient.lastName}`.toLowerCase().includes(q)) ||
          (r.patient && r.patient.phone.includes(q))
        );
      })
      .sort((a, b) => b.pendingItems - a.pendingItems);
  }, [prescriptions, search]);

  const dialogRxs = dialogPatientId ? prescriptions.filter(rx => rx.patientId === dialogPatientId) : [];
  const dialogPatient = dialogPatientId ? db.getPatientById(dialogPatientId) : null;

  const toggleCheck = (key: string) => {
    setCheckedKeys(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  };

  const handleDispenseChecked = () => {
    if (checkedKeys.length === 0) return;
    try {
      checkedKeys.forEach(key => {
        const [rxId, itemId] = key.split(':');
        const rx = prescriptions.find(r => r.id === rxId);
        const item = rx?.items.find(i => i.id === itemId);
        if (!rx || !item) return;
        const remaining = item.quantityPrescribed - item.quantityDispensed;
        if (remaining <= 0) return;
        db.dispensePrescriptionItem(rxId, itemId, remaining, batchNotes, currentUser);
      });
      setCheckedKeys([]);
      setBatchNotes('');
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Dispensed items across all prescriptions, with date-range + sort
  const dispensedRows = React.useMemo(() => {
    const rows: Array<{ rx: Prescription; item: PrescriptionItem; date: string }> = [];
    prescriptions.forEach(rx => {
      rx.items.forEach(item => {
        if (item.quantityDispensed <= 0) return;
        rows.push({ rx, item, date: item.dispensedAt || rx.prescribedAt });
      });
    });
    const from = dispFrom ? new Date(dispFrom + 'T00:00:00').getTime() : null;
    const to = dispTo ? new Date(dispTo + 'T23:59:59').getTime() : null;
    return rows
      .filter(r => {
        const t = new Date(r.date).getTime();
        if (from !== null && t < from) return false;
        if (to !== null && t > to) return false;
        return true;
      })
      .sort((a, b) =>
        dispSort === 'newest'
          ? new Date(b.date).getTime() - new Date(a.date).getTime()
          : new Date(a.date).getTime() - new Date(b.date).getTime()
      );
  }, [prescriptions, dispFrom, dispTo, dispSort]);

  return (
    <div className="h-full flex flex-col select-text overflow-hidden p-4 md:p-6 space-y-4">
      {/* Compact control bar: view label + queue search */}
      <div className="rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex flex-wrap items-center gap-2 p-3 flex-shrink-0">
        <span className="px-3 py-1.5 rounded-xl text-xs font-bold bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 flex-shrink-0">
          {activeTab === 'queue'
            ? `Prescription Queue (${queuePatients.length})`
            : activeTab === 'inventory'
            ? `Medication Inventory (${medications.length})`
            : activeTab === 'dispensed'
            ? `Dispensed (${dispensedRows.length})`
            : activeTab === 'requests'
            ? `Stock Requests (${db.getMedicationRequests().length})`
            : `Consumables (${db.getClinicalConsumables().filter(c => c.category === 'Pharmacy' || c.category === 'General').length})`}
        </span>
        {activeTab === 'queue' && (
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search queue by patient name, hospital no or phone..."
              className="w-full pl-9 pr-4 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
        )}
      </div>

      {activeTab === 'queue' ? (
        /* PRESCRIPTION QUEUE */
        <div className="flex-1 min-h-0 overflow-hidden rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex flex-col">
          {/* PATIENT LIST — click a patient to see & dispense their prescriptions */}
          <div className="flex-1 overflow-y-auto space-y-2 p-3">
          {queuePatients.length === 0 ? (
            <div className="p-12 text-center text-slate-400">No patients with prescriptions found.</div>
          ) : (
            queuePatients.map(({ patientId, patient, rxs, pendingItems, total }) => (
              <div
                key={patientId}
                onClick={() => { setDialogPatientId(patientId); setCheckedKeys([]); setBatchNotes(''); }}
                className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex items-center justify-between gap-3 cursor-pointer hover:border-purple-400 hover:shadow-md transition-all"
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-950/40 flex items-center justify-center text-sm font-bold text-purple-600 flex-shrink-0">
                    {patient ? `${patient.firstName[0]}${patient.lastName[0]}` : '?'}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      {patient ? `${patient.firstName} ${patient.lastName}` : patientId}{' '}
                      <span className="font-mono text-[10px] text-slate-400">({patientId})</span>
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {patient ? `${patient.sex}, ${patient.age}y • ${patient.phone} • ` : ''}{rxs.length} prescription{rxs.length === 1 ? '' : 's'} • {settings.currency}{total.toLocaleString()}
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-2 flex-shrink-0">
                  {pendingItems > 0 ? (
                    <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800">
                      {pendingItems} pending
                    </span>
                  ) : (
                    <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">
                      All dispensed
                    </span>
                  )}
                  <span className="text-[11px] font-bold text-purple-600">Open →</span>
                </div>
              </div>
            ))
          )}
          </div>
        </div>
      ) : activeTab === 'consumables' ? (
        /* PHARMACY CONSUMABLES (harmonized, admin-priced) */
        <div className="flex-1 min-h-0 overflow-y-auto">
          <SectionConsumablesPanel
            section="Pharmacy"
            title="Pharmacy Consumables"
            subtitle="Pharmacy + General items. Request restock or log usage — stock is subtracted and patient-linked usage posts to the visit invoice. Prices are set by Administration."
            accentClass="bg-purple-600 hover:bg-purple-700"
          />
        </div>
      ) : activeTab === 'dispensed' ? (
        /* DISPENSED — every dispensed item, filterable by date range */
        <div className="flex-1 min-h-0 overflow-hidden rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex flex-col">
          <div className="flex flex-wrap items-center gap-2 p-3 border-b border-light-border dark:border-dark-border flex-shrink-0">
            <div className="flex items-center space-x-1.5 text-xs">
              <label className="font-bold text-slate-500">From:</label>
              <input type="date" value={dispFrom} onChange={e => setDispFrom(e.target.value)} className="px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-dark-surface border text-xs" />
            </div>
            <div className="flex items-center space-x-1.5 text-xs">
              <label className="font-bold text-slate-500">To:</label>
              <input type="date" value={dispTo} onChange={e => setDispTo(e.target.value)} className="w-full px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-dark-surface border text-xs" />
            </div>
            <div className="flex items-center space-x-1.5 text-xs">
              <label className="font-bold text-slate-500">Sort:</label>
              <select value={dispSort} onChange={e => setDispSort(e.target.value as any)} className="px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-dark-surface border text-xs font-bold">
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </div>
            {(dispFrom || dispTo) && (
              <button onClick={() => { setDispFrom(''); setDispTo(''); }} className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-600">Clear dates</button>
            )}
            <span className="ml-auto text-[11px] font-bold text-slate-400">{dispensedRows.length} dispensed item{dispensedRows.length === 1 ? '' : 's'}</span>
          </div>
          <div className="overflow-auto flex-1">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 dark:bg-dark-surface/60 border-b border-light-border dark:border-dark-border text-slate-500 uppercase text-[10px] font-extrabold sticky top-0 z-10">
                <tr>
                  <th className="py-3 px-4">Dispensed On</th>
                  <th className="py-3 px-4">Patient</th>
                  <th className="py-3 px-4">Medication</th>
                  <th className="py-3 px-4 text-center">Qty</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Rx / Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-light-border/60 dark:divide-dark-border/60">
                {dispensedRows.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-10 text-slate-400">Nothing dispensed in this date range yet.</td></tr>
                ) : (
                  dispensedRows.map(({ rx, item, date }) => {
                    const p = db.getPatientById(rx.patientId);
                    return (
                      <tr key={`${rx.id}-${item.id}`} className="hover:bg-slate-50/80 dark:hover:bg-dark-surface/40">
                        <td className="py-3 px-4 font-bold whitespace-nowrap">{new Date(date).toLocaleDateString()} <span className="font-normal text-slate-400">{new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></td>
                        <td className="py-3 px-4">
                          <div className="font-bold">{p ? `${p.firstName} ${p.lastName}` : rx.patientId}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{rx.patientId}</div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-bold">{item.medicationName} <span className="font-normal text-slate-400">({item.dosage})</span></div>
                          <div className="text-[10px] text-slate-400">{item.frequency} • {item.duration}</div>
                        </td>
                        <td className="py-3 px-4 text-center font-mono font-bold">{item.quantityDispensed}/{item.quantityPrescribed}</td>
                        <td className="py-3 px-4">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${item.dispenseStatus === 'Dispensed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                            {item.dispenseStatus}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-[11px] text-slate-500">
                          <div className="font-mono">{rx.id}</div>
                          {item.pharmacistNotes && <div className="italic truncate max-w-[180px]">{item.pharmacistNotes}</div>}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === 'requests' ? (
        /* STOCK REQUESTS — drug reorders unique to pharmacy */
        <MedicationRequestsPanel />
      ) : (
        /* MEDICATION INVENTORY */
        <div className="flex-1 min-h-0 overflow-hidden rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex flex-col">
          <div className="overflow-auto flex-1">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 dark:bg-dark-surface/60 border-b border-light-border dark:border-dark-border text-slate-500 uppercase text-[10px] font-extrabold sticky top-0 z-10">
                <tr>
                  <th className="py-3 px-4">Medication Name</th>
                  <th className="py-3 px-4">Category & Form</th>
                  <th className="py-3 px-4">Strength</th>
                  <th className="py-3 px-4">Stock Balance</th>
                  <th className="py-3 px-4 text-right">Unit Price</th>
                  <th className="py-3 px-4 text-center">Threshold Alert</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-light-border/60 dark:divide-dark-border/60">
                {medications.map(med => {
                  const isLow = med.currentStock <= med.minStockAlert;

                  return (
                    <tr key={med.id} className="hover:bg-slate-50/80 dark:hover:bg-dark-surface/40">
                      <td className="py-3.5 px-4">
                        <div className="font-extrabold text-slate-900 dark:text-white">{med.name}</div>
                        <span className="text-[10px] text-slate-400">{med.genericName}</span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">
                        <div>{med.category}</div>
                        <span className="text-[10px] text-slate-400">{med.dosageForm}</span>
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-700 dark:text-slate-200">
                        {med.strength}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`font-mono text-sm font-black ${isLow ? 'text-rose-600' : 'text-slate-900 dark:text-white'}`}>
                          {med.currentStock}
                        </span>
                        <span className="text-[10px] text-slate-400 ml-1">({med.dispensingUnit})</span>
                      </td>
                      <td className="py-3.5 px-4 text-right font-extrabold text-slate-800 dark:text-slate-200">
                        {settings.currency}{med.unitPrice.toLocaleString()}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {isLow ? (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-100 text-rose-700 animate-pulse">
                            <AlertTriangle className="w-3 h-3" />
                            <span>Low Stock Alert (Min {med.minStockAlert})</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Sufficient</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Patient Prescriptions Dialog — dispense each or check & dispense at once */}
      {dialogPatientId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setDialogPatientId(null)} />
          <div className="relative bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-2xl border max-h-[88vh] flex flex-col">
            <div className="px-5 py-4 border-b border-light-border dark:border-dark-border flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">
                  Prescriptions — {dialogPatient ? `${dialogPatient.firstName} ${dialogPatient.lastName}` : dialogPatientId}{' '}
                  <span className="font-mono text-[11px] text-purple-600">({dialogPatientId})</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">{dialogRxs.length} prescription{dialogRxs.length === 1 ? '' : 's'} • tick items and dispense at once, or dispense each one</p>
              </div>
              <button onClick={() => setDialogPatientId(null)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-surface"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto">
              {dialogRxs.map(rx => (
                <div key={rx.id} className="rounded-xl border border-light-border dark:border-dark-border overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 dark:bg-dark-surface/60 flex items-center justify-between text-xs">
                    <span className="font-mono font-bold text-purple-700 dark:text-purple-300">{rx.id}</span>
                    <span className="text-[11px] text-slate-500">by {rx.physicianName} • {new Date(rx.prescribedAt).toLocaleDateString()} • {settings.currency}{rx.totalPrice.toLocaleString()}</span>
                  </div>
                  <div className="divide-y divide-light-border/50 dark:divide-dark-border/50">
                    {rx.items.map(item => {
                      const key = `${rx.id}:${item.id}`;
                      const remaining = item.quantityPrescribed - item.quantityDispensed;
                      const done = item.dispenseStatus === 'Dispensed';
                      const med = db.getMedicationById(item.medicationId);
                      return (
                        <div key={item.id} className="px-3 py-2.5 flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-start space-x-2 min-w-0">
                            {!done ? (
                              <input
                                type="checkbox"
                                checked={checkedKeys.includes(key)}
                                onChange={() => toggleCheck(key)}
                                className="mt-1 w-4 h-4 rounded text-purple-600 focus:ring-purple-500 flex-shrink-0"
                                title="Tick to dispense with the batch"
                              />
                            ) : (
                              <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-500 flex-shrink-0" />
                            )}
                            <div className="min-w-0">
                              <div className="font-bold text-slate-900 dark:text-white">{item.medicationName} <span className="font-normal text-slate-400">({item.dosage} • {item.frequency})</span></div>
                              <div className="text-[11px] text-slate-500">Qty {item.quantityDispensed}/{item.quantityPrescribed} • Stock: {med?.currentStock ?? 'N/A'} {done ? '• Dispensed' : `• ${remaining} left`}</div>
                            </div>
                          </div>
                          {!done && (
                            <button
                              onClick={() => handleOpenDispense(rx, item)}
                              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white flex-shrink-0 flex items-center space-x-1"
                            >
                              <Package className="w-3.5 h-3.5" /><span>Dispense</span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 bg-slate-50 dark:bg-dark-surface/60 rounded-b-2xl flex flex-wrap items-center gap-2 flex-shrink-0">
              <input
                value={batchNotes}
                onChange={e => setBatchNotes(e.target.value)}
                placeholder="Batch notes (optional)"
                className="flex-1 min-w-[160px] px-3 py-2 text-xs rounded-xl bg-white dark:bg-dark-card border"
              />
              <button
                onClick={handleDispenseChecked}
                disabled={checkedKeys.length === 0}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40"
              >
                Dispense Checked ({checkedKeys.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dispense Modal */}
      {selectedRx && dispenseItem && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white dark:bg-dark-card border border-light-border dark:border-dark-border rounded-2xl shadow-2xl p-6 select-text animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white mb-1">
              Dispense Medication
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Prescription {selectedRx.id} • {dispenseItem.medicationName}
            </p>

            <form onSubmit={handleConfirmDispense} className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border">
                <div className="flex justify-between">
                  <span className="text-slate-400">Total Prescribed:</span>
                  <strong className="text-slate-800 dark:text-slate-200">{dispenseItem.quantityPrescribed}</strong>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-slate-400">Previously Dispensed:</span>
                  <strong className="text-slate-800 dark:text-slate-200">{dispenseItem.quantityDispensed}</strong>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-slate-400">Remaining to Dispense:</span>
                  <strong className="text-purple-600 font-bold">{dispenseItem.quantityPrescribed - dispenseItem.quantityDispensed}</strong>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Quantity Being Dispensed Now:
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  max={dispenseItem.quantityPrescribed - dispenseItem.quantityDispensed}
                  value={dispenseQty}
                  onChange={e => setDispenseQty(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 font-bold focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Pharmacist Dispensing Notes:
                </label>
                <input
                  type="text"
                  placeholder="e.g. Advised on completing full course with food"
                  value={pharmacistNotes}
                  onChange={e => setPharmacistNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRx(null);
                    setDispenseItem(null);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-dark-surface text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white shadow-sm"
                >
                  Confirm Dispensing & Update Stock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
