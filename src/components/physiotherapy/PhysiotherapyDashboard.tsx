import React, { useState, useEffect } from 'react';
import { PhysiotherapyOrder, Patient } from '../../types';
import { SectionConsumablesPanel } from '../common/SectionConsumablesPanel';
import { db } from '../../services/db';
import { useAuth } from '../../context/AuthContext';
import { useSyncDb } from '../../hooks/useSyncDb';
import {
  Search,
  CheckCircle2,
  Coins,
  Eye,
  X,
  Play,
  HeartPulse
} from 'lucide-react';

interface PhysiotherapyDashboardProps {
  initialCategory?: string;
  initialStatus?: string;
  initialTab?: 'queue' | 'equipment' | 'pricing';
  onSelectPatient?: (patient: Patient) => void;
}

export const PhysiotherapyDashboard: React.FC<PhysiotherapyDashboardProps> = ({
  initialCategory,
  initialStatus,
  initialTab = 'queue',
  onSelectPatient
}) => {
  const { currentUser } = useAuth();
  useSyncDb();

  const [activeTab, setActiveTab] = useState<'queue' | 'equipment' | 'pricing'>(initialTab);
  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategory || 'ALL');
  const [statusFilter, setStatusFilter] = useState<string>(initialStatus || 'ALL');
  const [search, setSearch] = useState('');

  // Session Logging Modal State
  const [activeOrderForSession, setActiveOrderForSession] = useState<PhysiotherapyOrder | null>(null);
  const [viewingNotesOrder, setViewingNotesOrder] = useState<PhysiotherapyOrder | null>(null);
  const [progressNotes, setProgressNotes] = useState('');
  const [sessionsDone, setSessionsDone] = useState<number>(1);
  const [sessionStatus, setSessionStatus] = useState<PhysiotherapyOrder['status']>('In Progress');

  useEffect(() => {
    if (initialCategory) setSelectedCategory(initialCategory);
    else setSelectedCategory('ALL');
  }, [initialCategory]);

  useEffect(() => {
    if (initialStatus) setStatusFilter(initialStatus);
    else setStatusFilter('ALL');
  }, [initialStatus]);

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  const orders = db.getPhysiotherapyOrders();
  const settings = db.getSettings();
  const consumables = db.getClinicalConsumables().filter(c => c.category === 'Physiotherapy');
  const services = db.getServicePrices().filter(s => s.name.toLowerCase().includes('physio') || s.name.toLowerCase().includes('rehab') || s.name.toLowerCase().includes('traction') || s.name.toLowerCase().includes('therapy'));

  const filteredOrders = orders.filter(ord => {
    const p = db.getPatientById(ord.patientId);
    const matchCategory = selectedCategory === 'ALL' || (ord.category && ord.category.toLowerCase().includes(selectedCategory.toLowerCase()));
    const matchStatus = statusFilter === 'ALL' || ord.status === statusFilter;
    const matchSearch = 
      ord.id.toLowerCase().includes(search.toLowerCase()) ||
      ord.serviceName.toLowerCase().includes(search.toLowerCase()) ||
      (p && `${p.firstName} ${p.lastName}`.toLowerCase().includes(search.toLowerCase())) ||
      ord.patientId.toLowerCase().includes(search.toLowerCase());
    return matchCategory && matchStatus && matchSearch;
  });

  const handleOpenSessionModal = (order: PhysiotherapyOrder) => {
    setActiveOrderForSession(order);
    setProgressNotes(order.progressNotes || '');
    setSessionsDone(order.sessionsCompleted ? Math.min(order.sessionsCompleted + 1, order.sessions) : 1);
    setSessionStatus(order.status === 'Requested' ? 'In Progress' : order.status);
  };

  const handleSaveSession = () => {
    if (!activeOrderForSession) return;
    db.recordPhysiotherapySession(activeOrderForSession.id, {
      progressNotes,
      sessionsCompleted: sessionsDone,
      status: sessionsDone >= activeOrderForSession.sessions ? 'Completed' : 'In Progress'
    }, currentUser);
    setActiveOrderForSession(null);
  };

  return (
    <div className="h-full flex flex-col select-text overflow-hidden p-4 md:p-6 space-y-4">
      {/* Compact view bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex-shrink-0">
        <div className="flex items-center space-x-2">
          {selectedCategory !== 'ALL' && (
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
              {selectedCategory}
            </span>
          )}
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
            {orders.length} order{orders.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex items-center space-x-1.5 bg-slate-100 dark:bg-dark-surface p-1 rounded-xl border border-light-border dark:border-dark-border text-xs font-bold">
          <button
            onClick={() => setActiveTab('queue')}
            className={`px-3 py-1 rounded-lg transition-all ${
              activeTab === 'queue'
                ? 'bg-white dark:bg-dark-card text-teal-600 dark:text-teal-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Queue ({orders.length})
          </button>
          <button
            onClick={() => setActiveTab('equipment')}
            className={`px-3 py-1 rounded-lg transition-all ${
              activeTab === 'equipment'
                ? 'bg-white dark:bg-dark-card text-teal-600 dark:text-teal-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Equipment ({consumables.length})
          </button>
          <button
            onClick={() => setActiveTab('pricing')}
            className={`px-3 py-1 rounded-lg transition-all ${
              activeTab === 'pricing'
                ? 'bg-white dark:bg-dark-card text-teal-600 dark:text-teal-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Tariffs ({services.length})
          </button>
        </div>
      </div>

      {activeTab === 'queue' && (
        <>
          {/* Filters & Search */}
          <div className="rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex flex-wrap items-center justify-between gap-3 p-3.5">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search therapy order ID, indication, patient..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            <div className="flex items-center space-x-1.5 overflow-x-auto">
              <span className="text-[11px] font-bold text-slate-400">Category:</span>
              {['ALL', 'Musculoskeletal', 'Neurological', 'Sports', 'Pediatric'].map(c => (
                <button
                  key={c}
                  onClick={() => setSelectedCategory(c)}
                  className={`px-2.5 py-1 rounded-xl text-[10px] font-bold transition-all ${
                    selectedCategory === c
                      ? 'bg-teal-600 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-dark-surface text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>

            <div className="flex items-center space-x-1.5">
              <span className="text-[11px] font-bold text-slate-400">Status:</span>
              {['ALL', 'Requested', 'In Progress', 'Completed'].map(st => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 rounded-xl text-[10px] font-bold transition-all ${
                    statusFilter === st
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-dark-surface text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {/* Orders Table */}
          <div className="flex-1 overflow-hidden rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex flex-col">
            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 dark:bg-dark-surface/60 border-b border-light-border dark:border-dark-border text-slate-500 uppercase text-[10px] font-extrabold sticky top-0 z-10">
                  <tr>
                    <th className="py-3 px-4">Order ID &amp; Date</th>
                    <th className="py-3 px-4">Patient</th>
                    <th className="py-3 px-4">Therapy Program</th>
                    <th className="py-3 px-4">Sessions Progress</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Package Fee</th>
                    <th className="py-3 px-4 text-center">Therapist Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-light-border/60 dark:divide-dark-border/60">
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-slate-400">
                        No physiotherapy appointments found matching filters.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map(order => {
                      const patient = db.getPatientById(order.patientId);
                      const completedCount = order.sessionsCompleted || 0;
                      const progressPct = Math.round((completedCount / order.sessions) * 100);

                      return (
                        <tr key={order.id} className="hover:bg-slate-50/80 dark:hover:bg-dark-surface/40 transition-colors">
                          <td className="py-3.5 px-4 font-mono font-bold text-slate-900 dark:text-white">
                            <div>{order.id}</div>
                            <span className="text-[10px] text-slate-400 font-sans font-normal">
                              {new Date(order.orderedAt).toLocaleDateString()} • {order.orderedBy}
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            {patient ? (
                              <div 
                                className="cursor-pointer group"
                                onClick={() => onSelectPatient && onSelectPatient(patient)}
                              >
                                <div className="font-bold text-slate-800 dark:text-slate-100 group-hover:text-teal-600 transition-colors">
                                  {patient.firstName} {patient.lastName}
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  {patient.id} • {patient.sex}, {patient.age}y
                                </div>
                              </div>
                            ) : (
                              <span>{order.patientId}</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-slate-900 dark:text-white">{order.serviceName}</div>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400">
                              {order.clinicalIndication || 'General Physical Rehabilitation'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 min-w-[160px]">
                            <div className="flex items-center justify-between text-[11px] font-bold mb-1">
                              <span className="text-slate-600 dark:text-slate-300">
                                {completedCount} of {order.sessions} sessions
                              </span>
                              <span className="text-teal-600 dark:text-teal-400">{progressPct}%</span>
                            </div>
                            <div className="w-full bg-slate-100 dark:bg-dark-surface h-2 rounded-full overflow-hidden">
                              <div 
                                className="bg-teal-500 h-full rounded-full transition-all duration-300"
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                              order.status === 'Completed'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : order.status === 'In Progress'
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                            }`}>
                              {order.status}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right font-extrabold text-slate-800 dark:text-slate-200">
                            {settings.currency}{order.price.toLocaleString()}
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <div className="flex items-center justify-center space-x-1.5">
                              {order.progressNotes && (
                                <button
                                  onClick={() => setViewingNotesOrder(order)}
                                  className="p-1.5 rounded-xl bg-slate-100 dark:bg-dark-surface hover:bg-slate-200 text-slate-600 dark:text-slate-300"
                                  title="View Clinical Progress Notes"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                onClick={() => handleOpenSessionModal(order)}
                                className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white shadow-xs transition-all"
                              >
                                <Play className="w-3 h-3" />
                                <span>Log Session</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Equipment & Consumables Tab — harmonized: request + log usage, admin-priced */}
      {activeTab === 'equipment' && (
        <div className="flex-1 overflow-y-auto min-h-0">
          <SectionConsumablesPanel
            section="Physiotherapy"
            title="Physiotherapy Equipment, Bands & Electrotherapy Consumables"
            subtitle="Hospital Central Inventory synchronized. Request restock or log usage — stock is subtracted and patient-linked usage posts to the visit invoice. Prices are set by Administration."
            accentClass="bg-teal-600 hover:bg-teal-700"
          />
        </div>
      )}

      {/* Pricing Tab */}
      {activeTab === 'pricing' && (
        <div className="flex-1 overflow-hidden rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex flex-col p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-extrabold text-slate-900 dark:text-white text-sm flex items-center space-x-2">
              <Coins className="w-4 h-4 text-emerald-500" />
              <span>Physiotherapy &amp; Rehab Tariffs &amp; Price Matrix</span>
            </h3>
            <span className="text-xs text-slate-400">Zero Hard-coding • Central Billing Synchronized</span>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 dark:bg-dark-surface/60 border-b border-light-border dark:border-dark-border text-slate-500 uppercase text-[10px] font-extrabold">
                <tr>
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Rehabilitation Service</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4 text-right">Standard Fee</th>
                  <th className="py-3 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-light-border/60 dark:divide-dark-border/60">
                {services.map(s => (
                  <tr key={s.id}>
                    <td className="py-3.5 px-4 font-mono font-bold text-slate-900 dark:text-white">{s.id}</td>
                    <td className="py-3.5 px-4 font-bold text-slate-800 dark:text-slate-100">{s.name}</td>
                    <td className="py-3.5 px-4">{s.category}</td>
                    <td className="py-3.5 px-4 text-right font-extrabold text-emerald-600 dark:text-emerald-400">
                      {settings.currency}{s.price.toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                        Active Tariff
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Log Session Modal */}
      {activeOrderForSession && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="w-full max-w-xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-light-border dark:border-dark-border flex items-center justify-between bg-teal-50 dark:bg-teal-950/40">
              <div className="flex items-center space-x-2">
                <HeartPulse className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                <h3 className="font-extrabold text-slate-900 dark:text-white text-base">
                  Record Therapy Session: {activeOrderForSession.serviceName}
                </h3>
              </div>
              <button 
                onClick={() => setActiveOrderForSession(null)}
                className="p-1 rounded-xl hover:bg-slate-200 dark:hover:bg-dark-surface text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 dark:bg-dark-surface p-3 rounded-2xl border border-light-border dark:border-dark-border">
                <div>
                  <span className="text-slate-400 block font-semibold">Patient:</span>
                  <strong className="text-slate-900 dark:text-white">{activeOrderForSession.patientId}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block font-semibold">Total Package:</span>
                  <strong className="text-slate-900 dark:text-white">{activeOrderForSession.sessions} Sessions</strong>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Completed Sessions Count (Cumulative)
                </label>
                <input
                  type="number"
                  min={1}
                  max={activeOrderForSession.sessions}
                  value={sessionsDone}
                  onChange={e => setSessionsDone(Number(e.target.value))}
                  className="w-full p-2.5 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-teal-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Therapist Progress Notes &amp; Functional Assessment
                </label>
                <textarea
                  rows={4}
                  value={progressNotes}
                  onChange={e => setProgressNotes(e.target.value)}
                  placeholder="Record range of motion improvements, pain scale reduction, exercises performed, resistance levels used, and next session goals..."
                  className="w-full p-3 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-teal-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-light-border dark:border-dark-border bg-slate-50 dark:bg-dark-surface flex items-center justify-end space-x-2">
              <button
                onClick={() => setActiveOrderForSession(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-200 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSession}
                className="flex items-center space-x-1.5 px-5 py-2 rounded-xl text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white shadow-md transition-all"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Save Progress Note &amp; Session</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Notes Modal */}
      {viewingNotesOrder && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="w-full max-w-lg bg-white dark:bg-dark-card border border-light-border dark:border-dark-border rounded-3xl shadow-2xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-3">
              <div>
                <h3 className="font-extrabold text-slate-900 dark:text-white text-base">
                  Rehabilitation Progress Notes
                </h3>
                <p className="text-xs text-slate-400">Order #{viewingNotesOrder.id} • {viewingNotesOrder.serviceName}</p>
              </div>
              <button 
                onClick={() => setViewingNotesOrder(null)}
                className="p-1 rounded-xl hover:bg-slate-100 dark:hover:bg-dark-surface text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-dark-surface space-y-1">
                <span className="font-bold text-slate-400 block">Session Record:</span>
                <div className="font-extrabold text-sm text-teal-600 dark:text-teal-400">
                  {viewingNotesOrder.sessionsCompleted || 0} of {viewingNotesOrder.sessions} Completed ({viewingNotesOrder.status})
                </div>
              </div>

              <div>
                <span className="font-bold text-slate-400 block mb-1">Clinical Assessment:</span>
                <p className="p-3 rounded-xl bg-slate-50 dark:bg-dark-surface text-slate-800 dark:text-slate-100 whitespace-pre-line">
                  {viewingNotesOrder.progressNotes || 'No notes entered'}
                </p>
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-light-border dark:border-dark-border">
                <span>Therapist: <strong className="text-slate-700 dark:text-slate-200">{viewingNotesOrder.treatedBy || 'Physiotherapist'}</strong></span>
                <span>Last Session: {viewingNotesOrder.lastSessionDate || 'N/A'}</span>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                onClick={() => setViewingNotesOrder(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 dark:bg-dark-surface text-slate-700 dark:text-slate-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
