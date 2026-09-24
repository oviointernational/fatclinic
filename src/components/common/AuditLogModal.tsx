import React, { useState } from 'react';
import { db } from '../../services/db';
import { AuditLog } from '../../types';
import { ShieldAlert, X, Search, Filter, Download, Lock } from 'lucide-react';

interface AuditLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientId?: string;
  patientName?: string;
}

export const AuditLogModal: React.FC<AuditLogModalProps> = ({
  isOpen,
  onClose,
  patientId,
  patientName
}) => {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  if (!isOpen) return null;

  const rawLogs = db.getAuditLogs(patientId);

  const filteredLogs = rawLogs.filter(log => {
    const matchesCat = categoryFilter === 'ALL' || log.category === categoryFilter;
    const matchesSearch = 
      log.action.toLowerCase().includes(search.toLowerCase()) ||
      log.details.toLowerCase().includes(search.toLowerCase()) ||
      log.userName.toLowerCase().includes(search.toLowerCase()) ||
      (log.patientName && log.patientName.toLowerCase().includes(search.toLowerCase())) ||
      (log.patientId && log.patientId.toLowerCase().includes(search.toLowerCase()));

    return matchesCat && matchesSearch;
  });

  const getCategoryColor = (cat: AuditLog['category']) => {
    switch (cat) {
      case 'PATIENT': return 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300';
      case 'CLINICAL': return 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300';
      case 'LABORATORY': return 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300';
      case 'PHARMACY': return 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300';
      case 'BILLING': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300';
      case 'ADMIN': return 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const handleExportCSV = () => {
    const headers = ['Log ID', 'Timestamp', 'Staff User', 'Role', 'Category', 'Action', 'Patient ID', 'Patient Name', 'Details'];
    const rows = filteredLogs.map(l => [
      l.id,
      l.timestamp,
      `"${l.userName}"`,
      l.userRole,
      l.category,
      l.action,
      l.patientId || '',
      `"${l.patientName || ''}"`,
      `"${l.details.replace(/"/g, '""')}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `FatClinic_AuditLog_${patientId || 'Full'}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-5xl h-[85vh] flex flex-col bg-white dark:bg-dark-card border border-light-border dark:border-dark-border rounded-3xl shadow-2xl overflow-hidden select-text animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-light-border dark:border-dark-border flex items-center justify-between bg-slate-50 dark:bg-dark-surface/50">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                  Immutable Clinical & System Audit Log
                </h3>
                <span className="flex items-center space-x-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                  <Lock className="w-2.5 h-2.5" />
                  <span>Tamper-Proof Stream</span>
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {patientId ? `Audit history filtered for ${patientName || patientId} (${patientId})` : 'Comprehensive hospital-wide chronological action ledger'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleExportCSV}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-dark-card border border-light-border dark:border-dark-border text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-surface shadow-sm transition-all"
            >
              <Download className="w-3.5 h-3.5 text-emerald-500" />
              <span>Export CSV</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-dark-surface transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="px-6 py-3 border-b border-light-border dark:border-dark-border flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-dark-card">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search by action, keyword, staff name, or patient..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="flex items-center space-x-2">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs font-semibold text-slate-500">Category:</span>
            {['ALL', 'CLINICAL', 'LABORATORY', 'PHARMACY', 'BILLING', 'PATIENT', 'ADMIN'].map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all ${
                  categoryFilter === cat
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-slate-100 dark:bg-dark-surface text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Log Entries Table */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {filteredLogs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400">
              <ShieldAlert className="w-12 h-12 stroke-[1.2] mb-2 opacity-40" />
              <p className="text-sm font-semibold">No audit logs matching this search criteria</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredLogs.map(item => (
                <div
                  key={item.id}
                  className="p-3.5 rounded-2xl bg-slate-50/70 dark:bg-dark-surface/40 border border-light-border/60 dark:border-dark-border/60 flex items-start space-x-3.5 hover:border-emerald-500/40 transition-all"
                >
                  <div className="mt-1 flex-shrink-0">
                    <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md ${getCategoryColor(item.category)}`}>
                      {item.category}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                          {item.action.replace(/_/g, ' ')}
                        </span>
                        {item.patientId && (
                          <span className="text-[10px] font-semibold text-slate-500 bg-white dark:bg-dark-card px-1.5 py-0.5 rounded border border-light-border dark:border-dark-border">
                            Patient: {item.patientName || item.patientId} ({item.patientId})
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] font-mono text-slate-400">
                        {new Date(item.timestamp).toLocaleString()}
                      </span>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                      {item.details}
                    </p>

                    <div className="flex items-center space-x-2 mt-2 text-[10px] text-slate-400">
                      <span>Staff: <strong className="text-slate-600 dark:text-slate-300">{item.userName}</strong></span>
                      <span>•</span>
                      <span>Role: <strong className="text-slate-600 dark:text-slate-300">{item.userRole.replace('_', ' ')}</strong></span>
                      <span>•</span>
                      <span className="font-mono">{item.id}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-2.5 border-t border-light-border dark:border-dark-border bg-slate-50 dark:bg-dark-surface/40 text-[11px] text-slate-400 flex justify-between items-center">
          <span>Showing <strong>{filteredLogs.length}</strong> recorded actions in tamper-proof ledger</span>
          <span>FatClinic Certified Immutable Security Stream</span>
        </div>
      </div>
    </div>
  );
};
