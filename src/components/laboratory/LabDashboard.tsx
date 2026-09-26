import React, { useState } from 'react';
import { LabRequest, LabCategory, LabTestOrder, Patient } from '../../types';
import { db } from '../../services/db';
import { useCurrentUser } from '../../context/AuthContext';
import { pdfService } from '../../services/pdfService';
import { useSyncDb } from '../../hooks/useSyncDb';
import {
  Search,
  Printer,
  FileEdit,
  ArrowRight,
  Filter,
  Eye,
  Lock
} from 'lucide-react';
import { ResultEntryModal } from './ResultEntryModal';
import { labCapabilities } from '../../services/permissions';

interface LabDashboardProps {
  initialCategory?: LabCategory;
  initialStatus?: string;
  alertsOnly?: boolean;
}

export const LabDashboard: React.FC<LabDashboardProps> = ({
  initialCategory,
  initialStatus,
  alertsOnly = false,
}) => {
  const currentUser = useCurrentUser();
  useSyncDb();
  const [selectedCategory, setSelectedCategory] = useState<LabCategory | 'ALL'>(initialCategory || 'ALL');
  const [statusFilter, setStatusFilter] = useState<string>(initialStatus || 'ALL');
  const [search, setSearch] = useState('');

  React.useEffect(() => {
    if (initialCategory) {
      setSelectedCategory(initialCategory);
    } else {
      setSelectedCategory('ALL');
    }
  }, [initialCategory]);

  React.useEffect(() => {
    if (initialStatus) {
      setStatusFilter(initialStatus);
    } else {
      setStatusFilter('ALL');
    }
  }, [initialStatus]);

  // Result entry modal (readOnly for doctors / nurses — view only)
  const [activeRequest, setActiveRequest] = useState<LabRequest | null>(null);
  const [activeTestOrder, setActiveTestOrder] = useState<LabTestOrder | null>(null);
  const [resultReadOnly, setResultReadOnly] = useState(false);

  const labRequests = db.getLabRequests();
  const settings = db.getSettings();
  const customRole = currentUser.customRoleId ? db.getCustomRoleById(currentUser.customRoleId) : undefined;
  const capsFor = (category: LabCategory) => labCapabilities(currentUser, category, customRole);

  // Flatten tests for granular laboratory workflow processing.
  // Diagnostic Alerts mode: only critical-flagged or Urgent/STAT orders.
  const testRows: Array<{ request: LabRequest; test: LabTestOrder; patient?: Patient }> = [];
  labRequests.forEach(req => {
    const p = db.getPatientById(req.patientId);
    req.tests.forEach(test => {
      const matchCat = selectedCategory === 'ALL' || test.category === selectedCategory;
      const matchStatus = statusFilter === 'ALL' || test.status === statusFilter;
      const matchAlert = !alertsOnly || test.criticalAlert || req.priority === 'Urgent' || req.priority === 'STAT';
      const matchSearch =
        test.testName.toLowerCase().includes(search.toLowerCase()) ||
        req.id.toLowerCase().includes(search.toLowerCase()) ||
        (p && `${p.firstName} ${p.lastName}`.toLowerCase().includes(search.toLowerCase())) ||
        req.patientId.toLowerCase().includes(search.toLowerCase());

      if (matchCat && matchStatus && matchAlert && matchSearch) {
        testRows.push({ request: req, test, patient: p });
      }
    });
  });

  const handleOpenResultEntry = (req: LabRequest, test: LabTestOrder, readOnly = false) => {
    const caps = capsFor(test.category);
    if (!readOnly && !caps.canEnterResult) return;
    setResultReadOnly(readOnly);
    setActiveRequest(req);
    setActiveTestOrder(test);
  };

  const handleAdvanceStatus = (req: LabRequest, test: LabTestOrder) => {
    const caps = capsFor(test.category);
    if (test.status === 'Requested') {
      if (!caps.canProcess) return;
      db.updateLabTestStatus(req.id, test.id, 'Sample Collected', currentUser);
    } else if (test.status === 'Sample Collected') {
      if (!caps.canProcess) return;
      db.updateLabTestStatus(req.id, test.id, 'Processing', currentUser);
    } else if (test.status === 'Processing') {
      if (!caps.canEnterResult) return;
      handleOpenResultEntry(req, test);
    }
  };

  return (
    <div className="h-full flex flex-col select-text overflow-hidden p-4 space-y-3">
      {/* Compact control bar: context + search + status filters */}
      <div className="rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex flex-wrap items-center gap-2 p-3 flex-shrink-0">
        <div className="flex items-center space-x-2 flex-shrink-0">
          {selectedCategory !== 'ALL' ? (
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
              {selectedCategory.replace(/_/g, ' ')}
            </span>
          ) : alertsOnly ? (
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
              Critical & Urgent only
            </span>
          ) : null}
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
            {testRows.length} test{testRows.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-4 h-4 absolute left-3 top-2 text-slate-400" />
          <input
            type="text"
            placeholder="Search investigation, patient, or order ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div className="flex items-center space-x-1.5 overflow-x-auto">
          <Filter className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
          {['ALL', 'Requested', 'Sample Collected', 'Processing', 'Result Entered', 'Released'].map(st => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-2 py-1 text-[10px] font-bold rounded-lg transition-all flex-shrink-0 ${
                statusFilter === st
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-dark-surface text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              {st === 'Sample Collected' ? 'Sample' : st === 'Result Entered' ? 'Result' : st}
            </button>
          ))}
        </div>
      </div>

      {/* Tests Table */}
      <div className="flex-1 overflow-hidden rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex flex-col min-h-0 relative">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 dark:bg-dark-surface/60 border-b border-light-border dark:border-dark-border text-slate-500 uppercase text-[10px] font-extrabold sticky top-0 z-10">
              <tr>
                <th className="py-3 px-4">Order ID & Date</th>
                <th className="py-3 px-4">Patient Details</th>
                <th className="py-3 px-4">Investigation & Category</th>
                <th className="py-3 px-4">Specimen Sample</th>
                <th className="py-3 px-4">Status & Priority</th>
                <th className="py-3 px-4 text-right">Fee</th>
                <th className="py-3 px-4 text-center">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-light-border/60 dark:divide-dark-border/60">
              {testRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-400">
                    No investigations found matching this department/status filter.
                  </td>
                </tr>
              ) : (
                testRows.map(({ request, test, patient }) => (
                  <tr
                    key={test.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-dark-surface/40 transition-colors"
                  >
                    {/* Order ID */}
                    <td className="py-3.5 px-4">
                      <div className="font-mono font-bold text-slate-900 dark:text-white">
                        {request.id}
                      </div>
                      <span className="text-[10px] text-slate-400">
                        {new Date(request.requestedAt).toLocaleDateString()} by {request.physicianName}
                      </span>
                    </td>

                    {/* Patient */}
                    <td className="py-3.5 px-4">
                      {patient ? (
                        <div>
                          <div className="font-bold text-slate-800 dark:text-slate-100">
                            {patient.firstName} {patient.lastName}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {patient.id} • {patient.sex}, {patient.age}y
                          </div>
                        </div>
                      ) : (
                        <span>{request.patientId}</span>
                      )}
                    </td>

                    {/* Investigation */}
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900 dark:text-white">
                        {test.testName}
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-dark-surface text-slate-600 dark:text-slate-300">
                        {test.category.replace('_', ' ')}
                      </span>
                    </td>

                    {/* Sample */}
                    <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300 text-[11px]">
                      {test.sampleType}
                    </td>

                    {/* Status & Priority */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center space-x-1.5">
                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                          test.status === 'Released'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : test.status === 'Processing'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                        }`}>
                          {test.status}
                        </span>
                        {request.priority !== 'Routine' && (
                          <span className="text-[9px] font-extrabold px-1.5 py-0.2 rounded bg-rose-100 text-rose-700">
                            {request.priority}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Fee */}
                    <td className="py-3.5 px-4 text-right font-extrabold text-slate-800 dark:text-slate-200">
                      {settings.currency}{test.price.toLocaleString()}
                    </td>

                    {/* Result — only Medical Laboratory Scientists change workflow; doctors & nurses view only */}
                    <td className="py-3.5 px-4 text-center">
                      {(() => {
                        const caps = capsFor(test.category);
                        const hasResults = !!test.results?.length;
                        return (
                          <div className="flex items-center justify-center space-x-1.5">
                            {test.status === 'Released' ? (
                              <>
                                <button
                                  onClick={() => patient && pdfService.exportLabReport(request, patient)}
                                  className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 hover:bg-emerald-100 border border-emerald-200 dark:border-emerald-800 transition-all"
                                  title="Print Official Diagnostic Lab Report"
                                >
                                  <Printer className="w-3.5 h-3.5" />
                                  <span>Print Report</span>
                                </button>
                                {hasResults && !caps.canEnterResult && (
                                  <button
                                    onClick={() => handleOpenResultEntry(request, test, true)}
                                    className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 transition-all"
                                    title="View result values (read-only)"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                    <span>View</span>
                                  </button>
                                )}
                              </>
                            ) : caps.canProcess || caps.canEnterResult ? (
                              <>
                                <button
                                  onClick={() => handleAdvanceStatus(request, test)}
                                  disabled={
                                    (test.status === 'Requested' && !caps.canProcess) ||
                                    (test.status === 'Sample Collected' && !caps.canProcess) ||
                                    (test.status === 'Processing' && !caps.canEnterResult)
                                  }
                                  className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-sm transition-all disabled:opacity-40"
                                >
                                  <span>
                                    {test.status === 'Requested' ? 'Collect Sample' : test.status === 'Sample Collected' ? 'Start Processing' : 'Enter Results'}
                                  </span>
                                  <ArrowRight className="w-3 h-3" />
                                </button>

                                {caps.canEnterResult && (
                                  <button
                                    onClick={() => handleOpenResultEntry(request, test)}
                                    className="p-1.5 rounded-xl bg-slate-100 dark:bg-dark-surface hover:bg-slate-200 text-slate-600 dark:text-slate-300"
                                    title="Direct Result Entry Modal"
                                  >
                                    <FileEdit className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </>
                            ) : hasResults ? (
                              <button
                                onClick={() => handleOpenResultEntry(request, test, true)}
                                className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 transition-all"
                                title="View result values (read-only — only Medical Laboratory Scientists enter results)"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>View Result</span>
                              </button>
                            ) : (
                              <span className="inline-flex items-center space-x-1 text-[11px] font-bold text-slate-400">
                                <Lock className="w-3 h-3" />
                                <span>Awaiting scientist</span>
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Result Entry Modal */}
      {activeRequest && activeTestOrder && (
        <ResultEntryModal
          request={activeRequest}
          testOrder={activeTestOrder}
          readOnly={resultReadOnly}
          onClose={() => {
            setActiveRequest(null);
            setActiveTestOrder(null);
            setResultReadOnly(false);
          }}
          onSave={() => {
            setActiveRequest(null);
            setActiveTestOrder(null);
            setResultReadOnly(false);
          }}
        />
      )}
    </div>
  );
};
