import React, { useState } from 'react';
import { db } from '../../services/db';
import { useCurrentUser } from '../../context/AuthContext';
import { useSyncDb } from '../../hooks/useSyncDb';
import { SectionConsumablesPanel } from '../common/SectionConsumablesPanel';
import {
  CheckCircle2,
  Search
} from 'lucide-react';
import { LabStockItem } from '../../types';

export const LabStockManagement: React.FC = () => {
  const currentUser = useCurrentUser();
  useSyncDb();

  const [activeTab, setActiveTab] = useState<'inventory' | 'consumables' | 'requests'>('inventory');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  const [usageItem, setUsageItem] = useState<LabStockItem | null>(null);
  const [usageQty, setUsageQty] = useState<number>(1);
  const [restockItem, setRestockItem] = useState<LabStockItem | null>(null);
  const [restockQty, setRestockQty] = useState<number>(10);
  const [restockUrgency, setRestockUrgency] = useState<'Routine' | 'Urgent'>('Routine');
  const [notification, setNotification] = useState<string | null>(null);

  const stockItems = db.getLabStockItems();
  const stockRequests = db.getLabStockRequests();
  const settings = db.getSettings();

  const filteredItems = stockItems.filter(item => {
    const matchCat = categoryFilter === 'ALL' || item.category === categoryFilter;
    const matchSearch = item.name.toLowerCase().includes(search.toLowerCase()) || item.category.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 4000);
  };

  const handleLogUsage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!usageItem || usageQty <= 0) return;
    db.logLabStockUsage(usageItem.id, usageQty, currentUser);
    showNotification(`Logged usage of ${usageQty} ${usageItem.unit} for ${usageItem.name}.`);
    setUsageItem(null);
    setUsageQty(1);
  };

  const handleRequestRestock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!restockItem || restockQty <= 0) return;
    db.requestLabRestock(restockItem.id, restockQty, restockUrgency, currentUser);
    showNotification(`Restock request submitted for ${restockQty} ${restockItem.unit} of ${restockItem.name}.`);
    setRestockItem(null);
    setRestockQty(10);
  };

  return (
    <div className="h-full flex flex-col select-text overflow-hidden p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex-shrink-0">
        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 px-1">
          {stockItems.length} items • {stockRequests.length} requisitions
        </span>

        <div className="flex items-center space-x-2 bg-slate-100 dark:bg-dark-surface p-1 rounded-xl border border-light-border dark:border-dark-border">
          <button
            onClick={() => setActiveTab('inventory')}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'inventory'
                ? 'bg-white dark:bg-dark-card text-amber-700 dark:text-amber-300 shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Stock Levels ({stockItems.length})
          </button>
          <button
            onClick={() => setActiveTab('consumables')}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'consumables'
                ? 'bg-white dark:bg-dark-card text-amber-700 dark:text-amber-300 shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Lab Consumables ({db.getClinicalConsumables().filter(c => c.category === 'Laboratory' || c.category === 'General').length})
          </button>
          <button
            onClick={() => setActiveTab('requests')}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'requests'
                ? 'bg-white dark:bg-dark-card text-amber-700 dark:text-amber-300 shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Requisition Requests ({stockRequests.length})
          </button>
        </div>
      </div>

      {notification && (
        <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-xs font-bold text-emerald-700 dark:text-emerald-300 flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{notification}</span>
        </div>
      )}

      {activeTab === 'consumables' ? (
        <div className="flex-1 overflow-y-auto min-h-0">
          <SectionConsumablesPanel
            section="Laboratory"
            title="Laboratory Consumables"
            subtitle="Laboratory + General items (harmonized with Administration). Request restock or log usage — stock is subtracted and patient-linked usage posts to the visit invoice. Prices are set by Administration."
            accentClass="bg-amber-500 hover:bg-amber-600"
          />
        </div>
      ) : activeTab === 'inventory' ? (
        <>
          <div className="rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex flex-wrap items-center justify-between gap-2 p-4">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search reagents, consumables, test kits..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="flex items-center space-x-1.5 overflow-x-auto">
              {['ALL', 'Reagents', 'Consumables', 'Tubes', 'Kits', 'Stains'].map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                    categoryFilter === cat
                      ? 'bg-amber-500 text-white shadow-sm'
                      : 'bg-slate-100 dark:bg-dark-surface text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-hidden rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex flex-col">
            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 dark:bg-dark-surface/60 border-b border-light-border dark:border-dark-border text-slate-500 uppercase text-[10px] font-extrabold sticky top-0 z-10">
                  <tr>
                    <th className="py-3 px-4">Item &amp; Category</th>
                    <th className="py-3 px-4 text-center">Available Stock</th>
                    <th className="py-3 px-4 text-center">Alert Threshold</th>
                    <th className="py-3 px-4 text-right">Unit Value</th>
                    <th className="py-3 px-4 text-right">Last Logged</th>
                    <th className="py-3 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-light-border/60 dark:divide-dark-border/60">
                  {filteredItems.map(item => {
                    const isLow = item.currentStock <= item.minAlertLevel;
                    return (
                      <tr key={item.id} className="hover:bg-slate-50/80 dark:hover:bg-dark-surface/40 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="font-extrabold text-slate-900 dark:text-white">{item.name}</div>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-dark-surface text-slate-500 font-bold">
                            {item.category}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <span className={`text-sm font-black px-2.5 py-1 rounded-xl ${
                            isLow 
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 ring-1 ring-rose-400' 
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          }`}>
                            {item.currentStock} {item.unit}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center text-slate-500 font-semibold">
                          {item.minAlertLevel} {item.unit}
                        </td>
                        <td className="py-3.5 px-4 text-right font-extrabold text-slate-800 dark:text-slate-200">
                          {settings.currency}{item.unitCost.toLocaleString()}
                        </td>
                        <td className="py-3.5 px-4 text-right text-[11px] text-slate-400">
                          {item.lastUsedAt ? new Date(item.lastUsedAt).toLocaleDateString() : 'Never'}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <div className="flex items-center justify-center space-x-2">
                            <button
                              onClick={() => { setUsageItem(item); setUsageQty(1); }}
                              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-dark-surface hover:bg-slate-200 text-slate-700 dark:text-slate-200 transition-all"
                            >
                              Log Usage
                            </button>
                            <button
                              onClick={() => { setRestockItem(item); setRestockQty(10); }}
                              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-xs transition-all"
                            >
                              Request Restock
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-hidden rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex flex-col">
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 dark:bg-dark-surface/60 border-b border-light-border dark:border-dark-border text-slate-500 uppercase text-[10px] font-extrabold sticky top-0 z-10">
                <tr>
                  <th className="py-3 px-4">Request ID &amp; Date</th>
                  <th className="py-3 px-4">Requisition Item</th>
                  <th className="py-3 px-4 text-center">Quantity Requested</th>
                  <th className="py-3 px-4">Urgency</th>
                  <th className="py-3 px-4">Requested By</th>
                  <th className="py-3 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-light-border/60 dark:divide-dark-border/60">
                {stockRequests.map(req => (
                  <tr key={req.id} className="hover:bg-slate-50/80 dark:hover:bg-dark-surface/40 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-bold text-slate-900 dark:text-white">
                      {req.id}
                      <div className="text-[10px] text-slate-400 font-sans">{new Date(req.requestedAt).toLocaleDateString()}</div>
                    </td>
                    <td className="py-3.5 px-4 font-extrabold text-slate-800 dark:text-slate-100">
                      {req.itemName}
                    </td>
                    <td className="py-3.5 px-4 text-center font-bold text-slate-900 dark:text-white">
                      {req.quantityRequested} units
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                        req.urgency === 'Urgent' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {req.urgency}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">
                      {req.requestedBy}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                        {req.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {usageItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-dark-card border border-light-border dark:border-dark-border rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
              Log Usage: {usageItem.name}
            </h3>
            <p className="text-xs text-slate-500">
              Current stock: <strong>{usageItem.currentStock} {usageItem.unit}</strong>. Enter amount consumed:
            </p>
            <form onSubmit={handleLogUsage} className="space-y-4">
              <input
                type="number"
                min={1}
                max={usageItem.currentStock}
                value={usageQty}
                onChange={e => setUsageQty(Number(e.target.value))}
                className="w-full px-4 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-lg font-black text-slate-900 dark:text-white"
              />
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setUsageItem(null)}
                  className="flex-1 px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 dark:bg-dark-surface text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-sm"
                >
                  Confirm Usage
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {restockItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-dark-card border border-light-border dark:border-dark-border rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
              Request Restock: {restockItem.name}
            </h3>
            <p className="text-xs text-slate-500">
              Submit an official procurement requisition for this item:
            </p>
            <form onSubmit={handleRequestRestock} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Units Required ({restockItem.unit}):</label>
                <input
                  type="number"
                  min={1}
                  value={restockQty}
                  onChange={e => setRestockQty(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-900 dark:text-white font-bold"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Urgency:</label>
                <select
                  value={restockUrgency}
                  onChange={e => setRestockUrgency(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-900 dark:text-white font-semibold"
                >
                  <option value="Routine">Routine Requisition</option>
                  <option value="Urgent">Urgent Procurement</option>
                </select>
              </div>

              <div className="flex items-center space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRestockItem(null)}
                  className="flex-1 px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 dark:bg-dark-surface text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-sm"
                >
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
