import React, { useState } from 'react';
import { Invoice, PaymentRecord, Patient } from '../../types';
import { db } from '../../services/db';
import { useCurrentUser } from '../../context/AuthContext';
import { pdfService } from '../../services/pdfService';
import { useSyncDb } from '../../hooks/useSyncDb';
import {
  Receipt,
  CreditCard,
  Search,
  Printer
} from 'lucide-react';

interface CentralBillingProps {
  initialTab?: 'invoices' | 'pricing';
}

export const CentralBilling: React.FC<CentralBillingProps> = ({ 
  initialTab = 'invoices',
}) => {
  const currentUser = useCurrentUser();
  const syncTick = useSyncDb();
  const [activeTab, setActiveTab] = useState<'invoices' | 'pricing'>(initialTab);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  React.useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  // Payment modal state
  const [activeInvoice, setActiveInvoice] = useState<Invoice | null>(null);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payMethod, setPayMethod] = useState<PaymentRecord['paymentMethod']>('POS');

  const invoices = db.getInvoices();
  const services = db.getServicePrices();
  const settings = db.getSettings();

  const filteredInvoices = invoices.filter(inv => {
    const p = db.getPatientById(inv.patientId);
    const matchStatus = statusFilter === 'ALL' || inv.paymentStatus === statusFilter;
    const matchSearch = 
      inv.id.toLowerCase().includes(search.toLowerCase()) ||
      inv.patientId.toLowerCase().includes(search.toLowerCase()) ||
      (p && `${p.firstName} ${p.lastName}`.toLowerCase().includes(search.toLowerCase()));

    return matchStatus && matchSearch;
  });

  const isFrontDeskController = (['FRONT_DESK','BILLING_OFFICER','ADMINISTRATOR'] as const).includes(currentUser.role as any);

  const handleOpenPayment = (inv: Invoice) => {
    if (!isFrontDeskController) {
      alert('Front Desk Controlled: Payments are centrally managed by Front Desk / Billing Officer. Please switch workstation role to Front Desk to process payments (all bills are synchronized sitewide).');
      return;
    }
    setActiveInvoice(inv);
    setPayAmount(inv.balance);
    setPayMethod('POS');
  };

  const handleProcessPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeInvoice || payAmount <= 0) return;
    try {
      db.recordPayment(activeInvoice.id, Number(payAmount), payMethod, currentUser);
      setActiveInvoice(null);
    } catch (err:any) {
      alert(err.message);
    }
  };

  return (
    <div className="h-full flex flex-col select-text overflow-hidden p-4 md:p-6 space-y-4">
      {/* Compact identity + tab bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex-shrink-0">
        <div className="flex items-center space-x-2">
          <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-teal-500 flex items-center justify-center shadow-sm flex-shrink-0">
            <Receipt className="w-4 h-4 text-white" />
          </span>
          <span className="text-xs font-extrabold text-slate-900 dark:text-white">Central Billing</span>
          <span className="hidden sm:inline-flex items-center space-x-1.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Front Desk • Synced</span>
          </span>
        </div>

        <div className="flex items-center space-x-2 bg-slate-100 dark:bg-dark-surface p-1 rounded-xl border border-light-border dark:border-dark-border">
          <button
            onClick={() => setActiveTab('invoices')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'invoices'
                ? 'bg-white dark:bg-dark-card text-blue-700 dark:text-blue-300 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Hospital Invoices ({invoices.length})
          </button>
          <button
            onClick={() => setActiveTab('pricing')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'pricing'
                ? 'bg-white dark:bg-dark-card text-blue-700 dark:text-blue-300 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Price Schedule ({services.length})
          </button>
        </div>
      </div>

      {/* Sitewide Sync + Front Desk Controller Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-[11px] flex-shrink-0">
        <div className="flex items-center space-x-2 font-bold text-emerald-700 dark:text-emerald-300">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Sitewide Synchronized</span>
          <span className="text-emerald-300 dark:text-emerald-600">•</span>
          <span className="px-2 py-0.5 rounded-full bg-white dark:bg-dark-card border border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300">Front Desk Controlled</span>
          <span className="text-slate-400 font-mono text-[10px]">sync #{syncTick} • {invoices.length} invoice(s)</span>
        </div>
        <div className="text-[10px] text-slate-500">
          {isFrontDeskController ? <span className="font-bold text-emerald-600">You can record payments (Front Desk role)</span> : <span className="font-bold text-amber-600">Read-only: Switch to Front Desk / Billing Officer to collect payments</span>}
        </div>
      </div>

      {activeTab === 'invoices' ? (
        <>
          {/* Search & Status Filters */}
          <div className="rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex flex-wrap items-center justify-between gap-2 p-3 flex-shrink-0">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-2 text-slate-400" />
              <input
                type="text"
                placeholder="Search by invoice number, patient name or ID..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center space-x-2">
              <span className="text-xs font-semibold text-slate-500">Status:</span>
              {['ALL', 'Unpaid', 'Partially Paid', 'Paid'].map(st => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all ${
                    statusFilter === st
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-slate-100 dark:bg-dark-surface text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {/* Invoices List */}
          <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
            {filteredInvoices.length === 0 ? (
              <div className="p-12 text-center text-slate-400">No invoices found.</div>
            ) : (
              filteredInvoices.map(inv => {
                const patient = db.getPatientById(inv.patientId);

                return (
                  <div
                    key={inv.id}
                    className="p-5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-3"
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-3">
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-mono font-bold text-sm text-blue-700 dark:text-blue-400">
                            {inv.id}
                          </span>
                          <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full ${
                            inv.paymentStatus === 'Paid'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : inv.paymentStatus === 'Partially Paid'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                              : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                          }`}>
                            {inv.paymentStatus}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Patient: <strong>{patient?.firstName} {patient?.lastName}</strong> ({inv.patientId}) • Date: {inv.date}
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        {patient && (
                          <button
                            onClick={() => pdfService.exportInvoice(inv, patient)}
                            className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-dark-surface hover:bg-slate-200 text-slate-700 dark:text-slate-200 transition-all"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span>Print Invoice / Receipt</span>
                          </button>
                        )}

                        {inv.balance > 0 && (
                          <button
                            onClick={() => handleOpenPayment(inv)}
                            title={isFrontDeskController ? "Record payment via Front Desk" : "Front Desk Controlled - switch role to Front Desk/Billing Officer"}
                            className={`flex items-center space-x-1 px-4 py-1.5 rounded-xl text-xs font-bold shadow-sm transition-all ${isFrontDeskController ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-slate-300 text-slate-500 cursor-not-allowed opacity-80'}`}
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                            <span>Record Payment</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Line Items Table */}
                    <div className="rounded-xl border border-light-border dark:border-dark-border overflow-hidden">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead className="bg-slate-50 dark:bg-dark-surface/80 text-[10px] uppercase font-bold text-slate-400">
                          <tr>
                            <th className="py-2 px-3">Service / Item Description</th>
                            <th className="py-2 px-3">Category</th>
                            <th className="py-2 px-3 text-center">Qty</th>
                            <th className="py-2 px-3 text-right">Unit Price</th>
                            <th className="py-2 px-3 text-right">Total Fee</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-light-border/40 dark:divide-dark-border/40">
                          {inv.items.map(item => (
                            <tr key={item.id} className="hover:bg-slate-50/40">
                              <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">{item.description}</td>
                              <td className="py-2 px-3 text-slate-500">
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-dark-surface">
                                  {item.serviceCategory}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-center font-mono">{item.quantity}</td>
                              <td className="py-2 px-3 text-right text-slate-500">{settings.currency}{item.unitPrice.toLocaleString()}</td>
                              <td className="py-2 px-3 text-right font-bold text-slate-900 dark:text-white">{settings.currency}{item.totalPrice.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Financial Summary Box */}
                    <div className="flex flex-wrap items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-dark-surface text-xs font-bold">
                      <div className="flex items-center space-x-4">
                        <span>Subtotal: {settings.currency}{inv.subtotal.toLocaleString()}</span>
                        {inv.discount > 0 && <span className="text-emerald-600">Discount: -{settings.currency}{inv.discount.toLocaleString()}</span>}
                        <span className="text-blue-700 dark:text-blue-400 text-sm">Invoice Total: {settings.currency}{inv.total.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center space-x-4">
                        <span className="text-emerald-600">Paid Amount: {settings.currency}{inv.paidAmount.toLocaleString()}</span>
                        <span className={`text-sm ${inv.balance > 0 ? 'text-rose-600 font-extrabold' : 'text-slate-400'}`}>
                          Balance Due: {settings.currency}{inv.balance.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : (
        /* STANDARD PRICING MATRIX */
        <div className="flex-1 min-h-0 overflow-hidden rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex flex-col">
          <div className="overflow-auto flex-1">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 dark:bg-dark-surface/60 border-b border-light-border dark:border-dark-border text-slate-500 uppercase text-[10px] font-extrabold sticky top-0 z-10">
                <tr>
                  <th className="py-3 px-4">Service Name</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Effective Date</th>
                  <th className="py-3 px-4 text-right">Standard Fee</th>
                  <th className="py-3 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-light-border/60 dark:divide-dark-border/60">
                {services.map(svc => (
                  <tr key={svc.id} className="hover:bg-slate-50/80 dark:hover:bg-dark-surface/40">
                    <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white">{svc.name}</td>
                    <td className="py-3.5 px-4">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-dark-surface text-slate-600 dark:text-slate-300">
                        {svc.category}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-500">{svc.effectiveDate}</td>
                    <td className="py-3.5 px-4 text-right font-extrabold text-emerald-600 dark:text-emerald-400">
                      {settings.currency}{svc.price.toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                        Active
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      {activeInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white dark:bg-dark-card border border-light-border dark:border-dark-border rounded-2xl shadow-2xl p-6 select-text animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white mb-1">
              Process Invoice Payment
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Invoice {activeInvoice.id} • Balance Due: <strong>{settings.currency}{activeInvoice.balance.toLocaleString()}</strong>
            </p>

            <form onSubmit={handleProcessPayment} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Amount to Pay:</label>
                <input
                  type="number"
                  required
                  min={1}
                  max={activeInvoice.balance}
                  value={payAmount}
                  onChange={e => setPayAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 font-bold focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Payment Method / Channel:</label>
                <select
                  value={payMethod}
                  onChange={e => setPayMethod(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 font-bold focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="POS">POS Terminal (Card Swipe)</option>
                  <option value="Transfer">Direct Bank Transfer</option>
                  <option value="Cash">Cash at Billing Counter</option>
                  <option value="Insurance">HMO / Health Insurance</option>
                  <option value="Card">Online Web Payment</option>
                </select>
              </div>

              <div className="flex justify-end space-x-2 pt-3">
                <button
                  type="button"
                  onClick={() => setActiveInvoice(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-dark-surface text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                >
                  Confirm & Issue Official Receipt
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
