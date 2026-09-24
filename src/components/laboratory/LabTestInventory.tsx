import React, { useState } from 'react';
import { db } from '../../services/db';
import { useAuth } from '../../context/AuthContext';
import { useSyncDb } from '../../hooks/useSyncDb';
import {
  Search,
  Edit2,
  CheckCircle2,
  Check
} from 'lucide-react';
import { LabInvestigationDefinition } from '../../types';

export const LabTestInventory: React.FC = () => {
  const { currentUser } = useAuth();
  useSyncDb();
  // Only Administration can change prices / edit investigations — all sections are read-only.
  const canEditPrice = currentUser.role === 'ADMINISTRATOR';

  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState<string>('ALL');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState<number>(0);
  const [notification, setNotification] = useState<string | null>(null);

  const investigations = db.getLabInvestigations();
  const settings = db.getSettings();

  const filteredTests = investigations.filter(inv => {
    const matchDept = deptFilter === 'ALL' || inv.category === deptFilter;
    const matchSearch = 
      inv.name.toLowerCase().includes(search.toLowerCase()) ||
      inv.code.toLowerCase().includes(search.toLowerCase()) ||
      inv.category.toLowerCase().includes(search.toLowerCase());
    return matchDept && matchSearch;
  });

  const handleStartEdit = (inv: LabInvestigationDefinition) => {
    setEditingId(inv.id);
    setEditPrice(inv.price);
  };

  const handleSavePrice = (id: string) => {
    if (editPrice < 0) return;
    db.updateLabInvestigationPrice(id, editPrice, currentUser);
    setEditingId(null);
    setNotification('Price updated successfully in laboratory fee schedule.');
    setTimeout(() => setNotification(null), 3000);
  };

  return (
    <div className="h-full flex flex-col select-text overflow-hidden p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex-shrink-0">
        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 px-1">
          {investigations.length} diagnostic tests • prices set by Administration
        </span>
        <span className="text-[11px] font-bold text-slate-400">Catalogue</span>
      </div>

      {notification && (
        <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-xs font-bold text-emerald-700 dark:text-emerald-300 flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{notification}</span>
        </div>
      )}

      <div className="rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex flex-wrap items-center justify-between gap-2 p-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search test code, name, or pathology branch..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-teal-500"
          />
        </div>

        <div className="flex items-center space-x-1.5 overflow-x-auto">
          {[
            { id: 'ALL', label: 'All Departments' },
            { id: 'HEMATOLOGY', label: 'Hematology' },
            { id: 'MICROBIOLOGY', label: 'Microbiology' },
            { id: 'CHEMICAL_PATHOLOGY', label: 'Chem Path' },
            { id: 'HISTOPATHOLOGY', label: 'Histopathology' },
            { id: 'MOLECULAR', label: 'Molecular' }
          ].map(cat => (
            <button
              key={cat.id}
              onClick={() => setDeptFilter(cat.id)}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                deptFilter === cat.id
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-dark-surface text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-hidden rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex flex-col">
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 dark:bg-dark-surface/60 border-b border-light-border dark:border-dark-border text-slate-500 uppercase text-[10px] font-extrabold sticky top-0 z-10">
              <tr>
                <th className="py-3 px-4">Code</th>
                <th className="py-3 px-4">Investigation Name</th>
                <th className="py-3 px-4">Pathology Department</th>
                <th className="py-3 px-4">Specimen Sample</th>
                <th className="py-3 px-4">Turnaround Time</th>
                <th className="py-3 px-4 text-right">Fee &amp; Price Schedule</th>
                <th className="py-3 px-4 text-center">Edit Fee</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-light-border/60 dark:divide-dark-border/60">
              {filteredTests.map(inv => {
                const isEditing = editingId === inv.id;
                return (
                  <tr key={inv.id} className="hover:bg-slate-50/80 dark:hover:bg-dark-surface/40 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-bold text-slate-900 dark:text-white">
                      {inv.code}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-extrabold text-slate-900 dark:text-white text-xs">{inv.name}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        inv.category === 'HEMATOLOGY' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300' :
                        inv.category === 'MICROBIOLOGY' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' :
                        inv.category === 'CHEMICAL_PATHOLOGY' ? 'bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300' :
                        'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300'
                      }`}>
                        {inv.category.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300 text-[11px]">
                      {inv.sampleType}
                    </td>
                    <td className="py-3.5 px-4 text-slate-500 text-[11px]">
                      {inv.turnaroundTime} TAT
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end space-x-1">
                          <span className="text-slate-400 font-bold">{settings.currency}</span>
                          <input
                            type="number"
                            value={editPrice}
                            onChange={e => setEditPrice(Number(e.target.value))}
                            className="w-24 px-2 py-1 text-xs font-bold rounded-lg border border-teal-500 bg-white dark:bg-dark-card text-slate-900 dark:text-white text-right"
                            autoFocus
                          />
                        </div>
                      ) : (
                        <span className="font-extrabold text-slate-900 dark:text-white text-xs">
                          {settings.currency}{inv.price.toLocaleString()}
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      {isEditing ? (
                        <div className="flex items-center justify-center space-x-1">
                          <button
                            onClick={() => handleSavePrice(inv.id)}
                            className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
                            title="Save new price"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="p-1.5 rounded-lg bg-slate-100 dark:bg-dark-surface hover:bg-slate-200 text-slate-500"
                            title="Cancel"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        canEditPrice ? (
                        <button
                          onClick={() => handleStartEdit(inv)}
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-surface text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors"
                          title="Update test price"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        ) : <span className="text-[10px] text-slate-400" title="Only Administration can change prices">Admin only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
