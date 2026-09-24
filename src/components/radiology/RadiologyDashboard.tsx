import React, { useState, useEffect } from 'react';
import { RadiologyOrder, Patient } from '../../types';
import { SectionConsumablesPanel } from '../common/SectionConsumablesPanel';
import { db } from '../../services/db';
import { useAuth } from '../../context/AuthContext';
import { useSyncDb } from '../../hooks/useSyncDb';
import { 
  Radio, 
  Search, 
  CheckCircle2, 
  FileEdit, 
  Printer,
  Coins,
  Eye,
  X
} from 'lucide-react';

interface RadiologyDashboardProps {
  initialModality?: string;
  initialStatus?: string;
  initialTab?: 'queue' | 'stock' | 'pricing';
  onSelectPatient?: (patient: Patient) => void;
}

export const RadiologyDashboard: React.FC<RadiologyDashboardProps> = ({
  initialModality,
  initialStatus,
  initialTab = 'queue',
  onSelectPatient
}) => {
  const { currentUser } = useAuth();
  useSyncDb();

  const [activeTab, setActiveTab] = useState<'queue' | 'stock' | 'pricing'>(initialTab);
  const [selectedModality, setSelectedModality] = useState<string>(initialModality || 'ALL');
  const [statusFilter, setStatusFilter] = useState<string>(initialStatus || 'ALL');
  const [search, setSearch] = useState('');

  // Report Modal State
  const [activeOrderForReport, setActiveOrderForReport] = useState<RadiologyOrder | null>(null);
  const [viewingReportOrder, setViewingReportOrder] = useState<RadiologyOrder | null>(null);
  const [findings, setFindings] = useState('');
  const [impression, setImpression] = useState('');
  const [filmSize, setFilmSize] = useState('14x17 inch');
  const [contrastUsed, setContrastUsed] = useState(false);

  useEffect(() => {
    if (initialModality) setSelectedModality(initialModality);
    else setSelectedModality('ALL');
  }, [initialModality]);

  useEffect(() => {
    if (initialStatus) setStatusFilter(initialStatus);
    else setStatusFilter('ALL');
  }, [initialStatus]);

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  const orders = db.getRadiologyOrders();
  const settings = db.getSettings();
  const consumables = db.getClinicalConsumables().filter(c => c.category === 'Radiology');
  const services = db.getServicePrices().filter(s => s.name.toLowerCase().includes('x-ray') || s.name.toLowerCase().includes('scan') || s.name.toLowerCase().includes('mri') || s.name.toLowerCase().includes('ultrasound'));

  const filteredOrders = orders.filter(ord => {
    const p = db.getPatientById(ord.patientId);
    const matchModality = selectedModality === 'ALL' || ord.modality.toLowerCase().includes(selectedModality.toLowerCase());
    const matchStatus = statusFilter === 'ALL' || ord.status === statusFilter;
    const matchSearch = 
      ord.id.toLowerCase().includes(search.toLowerCase()) ||
      ord.investigationName.toLowerCase().includes(search.toLowerCase()) ||
      (p && `${p.firstName} ${p.lastName}`.toLowerCase().includes(search.toLowerCase())) ||
      ord.patientId.toLowerCase().includes(search.toLowerCase());
    return matchModality && matchStatus && matchSearch;
  });

  const handleOpenReportModal = (order: RadiologyOrder) => {
    setActiveOrderForReport(order);
    setFindings(order.findings || '');
    setImpression(order.impression || '');
    setFilmSize(order.filmSize || '14x17 inch');
    setContrastUsed(order.contrastUsed || false);
  };

  const handleSaveReport = () => {
    if (!activeOrderForReport) return;
    db.saveRadiologyReport(activeOrderForReport.id, {
      findings,
      impression,
      filmSize,
      contrastUsed
    }, currentUser);
    setActiveOrderForReport(null);
  };

  return (
    <div className="h-full flex flex-col select-text overflow-hidden p-4 md:p-6 space-y-4">
      {/* Compact view bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex-shrink-0">
        <div className="flex items-center space-x-2">
          {selectedModality !== 'ALL' && (
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
              {selectedModality}
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
                ? 'bg-white dark:bg-dark-card text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Queue ({orders.length})
          </button>
          <button
            onClick={() => setActiveTab('stock')}
            className={`px-3 py-1 rounded-lg transition-all ${
              activeTab === 'stock'
                ? 'bg-white dark:bg-dark-card text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Films ({consumables.length})
          </button>
          <button
            onClick={() => setActiveTab('pricing')}
            className={`px-3 py-1 rounded-lg transition-all ${
              activeTab === 'pricing'
                ? 'bg-white dark:bg-dark-card text-indigo-600 dark:text-indigo-400 shadow-sm'
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
                placeholder="Search scan order ID, investigation, patient..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center space-x-1.5 overflow-x-auto">
              <span className="text-[11px] font-bold text-slate-400">Modality:</span>
              {['ALL', 'X-Ray', 'Ultrasound', 'CT Scan', 'MRI'].map(m => (
                <button
                  key={m}
                  onClick={() => setSelectedModality(m)}
                  className={`px-2.5 py-1 rounded-xl text-[10px] font-bold transition-all ${
                    selectedModality === m
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-dark-surface text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            <div className="flex items-center space-x-1.5">
              <span className="text-[11px] font-bold text-slate-400">Status:</span>
              {['ALL', 'Requested', 'Completed', 'Report Ready'].map(st => (
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
                    <th className="py-3 px-4">Modality &amp; Scan Name</th>
                    <th className="py-3 px-4">Clinical Indication</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Fee</th>
                    <th className="py-3 px-4 text-center">Radiologist Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-light-border/60 dark:divide-dark-border/60">
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-slate-400">
                        No radiology imaging requests found matching filters.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map(order => {
                      const patient = db.getPatientById(order.patientId);
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
                                <div className="font-bold text-slate-800 dark:text-slate-100 group-hover:text-indigo-600 transition-colors">
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
                            <div className="font-bold text-slate-900 dark:text-white">{order.investigationName}</div>
                            <span className="text-[10px] font-extrabold px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">
                              {order.modality}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300 max-w-[220px] truncate text-[11px]">
                            {order.clinicalNotes || 'None specified'}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                              order.status === 'Report Ready'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : order.status === 'Completed'
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
                              {order.status === 'Report Ready' ? (
                                <button
                                  onClick={() => setViewingReportOrder(order)}
                                  className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 border border-indigo-200 dark:border-indigo-800 transition-all"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>View Report</span>
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleOpenReportModal(order)}
                                  className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-all"
                                >
                                  <FileEdit className="w-3.5 h-3.5" />
                                  <span>File Report</span>
                                </button>
                              )}
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

      {/* Stock Tab — harmonized consumables: request + log usage, admin-priced */}
      {activeTab === 'stock' && (
        <div className="flex-1 overflow-y-auto min-h-0">
          <SectionConsumablesPanel
            section="Radiology"
            title="Radiology Medical Films & Imaging Consumables"
            subtitle="Synced with Hospital Central Inventory. Request restock or log usage — stock is subtracted and patient-linked usage posts to the visit invoice. Tariffs and prices are set by Administration."
            accentClass="bg-indigo-600 hover:bg-indigo-700"
          />
        </div>
      )}

      {/* Pricing Tab */}
      {activeTab === 'pricing' && (
        <div className="flex-1 overflow-hidden rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex flex-col p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-extrabold text-slate-900 dark:text-white text-sm flex items-center space-x-2">
              <Coins className="w-4 h-4 text-emerald-500" />
              <span>Radiology &amp; Imaging Procedure Tariff Directory</span>
            </h3>
            <span className="text-xs text-slate-400">Zero Hard-coding • Central Billing Synchronized</span>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 dark:bg-dark-surface/60 border-b border-light-border dark:border-dark-border text-slate-500 uppercase text-[10px] font-extrabold">
                <tr>
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Diagnostic Procedure</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4 text-right">Fee Rate</th>
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

      {/* File Report Modal */}
      {activeOrderForReport && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="w-full max-w-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-light-border dark:border-dark-border flex items-center justify-between bg-indigo-50 dark:bg-indigo-950/40">
              <div className="flex items-center space-x-2">
                <Radio className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                <h3 className="font-extrabold text-slate-900 dark:text-white text-base">
                  File Radiology Diagnostic Report: {activeOrderForReport.investigationName}
                </h3>
              </div>
              <button 
                onClick={() => setActiveOrderForReport(null)}
                className="p-1 rounded-xl hover:bg-slate-200 dark:hover:bg-dark-surface text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 dark:bg-dark-surface p-3 rounded-2xl border border-light-border dark:border-dark-border">
                <div>
                  <span className="text-slate-400 block font-semibold">Patient ID:</span>
                  <strong className="text-slate-900 dark:text-white">{activeOrderForReport.patientId}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block font-semibold">Order ID:</span>
                  <strong className="text-slate-900 dark:text-white">{activeOrderForReport.id}</strong>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-400 block font-semibold">Clinical Indication:</span>
                  <span className="text-slate-700 dark:text-slate-300">{activeOrderForReport.clinicalNotes || 'Routine investigation'}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Radiological Findings &amp; Observations
                </label>
                <textarea
                  rows={4}
                  value={findings}
                  onChange={e => setFindings(e.target.value)}
                  placeholder="Describe bone density, lung field lucency, organ dimensions, soft tissue symmetry, or acoustic shadows..."
                  className="w-full p-3 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Diagnostic Impression / Conclusion
                </label>
                <textarea
                  rows={2}
                  value={impression}
                  onChange={e => setImpression(e.target.value)}
                  placeholder="e.g. Normal chest radiograph, no active focal pulmonary consolidations seen."
                  className="w-full p-3 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Film Size / Digital PACS Matrix
                  </label>
                  <select
                    value={filmSize}
                    onChange={e => setFilmSize(e.target.value)}
                    className="w-full p-2 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:outline-none"
                  >
                    <option value="14x17 inch">14x17 inch Large Diagnostic Film</option>
                    <option value="11x14 inch">11x14 inch Medium Film</option>
                    <option value="8x10 inch">8x10 inch Extremities Film</option>
                    <option value="DICOM Digital">DICOM Digital Only (No physical film)</option>
                  </select>
                </div>

                <div className="flex items-center space-x-2 pt-6">
                  <input
                    type="checkbox"
                    id="contrastUsed"
                    checked={contrastUsed}
                    onChange={e => setContrastUsed(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                  />
                  <label htmlFor="contrastUsed" className="text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                    Intravenous Contrast Media Administered
                  </label>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-light-border dark:border-dark-border bg-slate-50 dark:bg-dark-surface flex items-center justify-end space-x-2">
              <button
                onClick={() => setActiveOrderForReport(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-200 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveReport}
                className="flex items-center space-x-1.5 px-5 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md transition-all"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Authorize &amp; Release Diagnostic Report</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Report Modal */}
      {viewingReportOrder && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="w-full max-w-xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border rounded-3xl shadow-2xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-3">
              <div>
                <h3 className="font-extrabold text-slate-900 dark:text-white text-base">
                  Diagnostic Radiology Report
                </h3>
                <p className="text-xs text-slate-400">Order #{viewingReportOrder.id} • {viewingReportOrder.modality}</p>
              </div>
              <button 
                onClick={() => setViewingReportOrder(null)}
                className="p-1 rounded-xl hover:bg-slate-100 dark:hover:bg-dark-surface text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-dark-surface space-y-1">
                <span className="font-bold text-slate-400 block">Investigation:</span>
                <div className="font-extrabold text-sm text-indigo-600 dark:text-indigo-400">{viewingReportOrder.investigationName}</div>
              </div>

              <div>
                <span className="font-bold text-slate-400 block mb-1">Findings:</span>
                <p className="p-3 rounded-xl bg-slate-50 dark:bg-dark-surface text-slate-800 dark:text-slate-100 whitespace-pre-line">
                  {viewingReportOrder.findings || 'No findings entered'}
                </p>
              </div>

              <div>
                <span className="font-bold text-slate-400 block mb-1">Impression:</span>
                <p className="p-3 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/30 text-indigo-900 dark:text-indigo-200 font-semibold">
                  {viewingReportOrder.impression || 'None'}
                </p>
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-light-border dark:border-dark-border">
                <span>Reported by: <strong className="text-slate-700 dark:text-slate-200">{viewingReportOrder.reportedBy || 'Radiologist'}</strong></span>
                <span>Date: {viewingReportOrder.reportedAt ? new Date(viewingReportOrder.reportedAt).toLocaleDateString() : 'N/A'}</span>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3">
              <button
                onClick={() => setViewingReportOrder(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 dark:bg-dark-surface text-slate-700 dark:text-slate-200"
              >
                Close
              </button>
              <button
                onClick={() => window.print()}
                className="flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white shadow-xs"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Official Report</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
