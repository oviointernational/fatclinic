import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../services/db';
import { useCurrentUser } from '../../context/AuthContext';
import { useSyncDb } from '../../hooks/useSyncDb';
import { pdfService } from '../../services/pdfService';
import { Invoice, PaymentRecord, Patient } from '../../types';
import {
  Search,
  Receipt,
  CheckCircle2,
  Printer,
  Plus,
  X,
  Stethoscope,
  Activity,
  FlaskConical,
  Pill,
  Radio,
  HeartPulse,
  User,
  Wallet
} from 'lucide-react';

interface FrontDeskCashierProps {
  onOpenTimeline?: (patient: Patient) => void;
  onOpenProfile?: (patient: Patient) => void;
}

type BillTab = 'physician' | 'nursing' | 'laboratory' | 'pharmacy' | 'radiology' | 'physiotherapy';

const BILL_TABS: Array<{ id: BillTab; label: string; icon: React.ReactNode }> = [
  { id: 'physician', label: 'Physician', icon: <Stethoscope className="w-3.5 h-3.5" /> },
  { id: 'nursing', label: 'Nursing', icon: <Activity className="w-3.5 h-3.5" /> },
  { id: 'laboratory', label: 'Laboratory', icon: <FlaskConical className="w-3.5 h-3.5" /> },
  { id: 'pharmacy', label: 'Pharmacy', icon: <Pill className="w-3.5 h-3.5" /> },
  { id: 'radiology', label: 'Radiology', icon: <Radio className="w-3.5 h-3.5" /> },
  { id: 'physiotherapy', label: 'Physiotherapy', icon: <HeartPulse className="w-3.5 h-3.5" /> },
];

export const FrontDeskCashier: React.FC<FrontDeskCashierProps> = ({ onOpenProfile }) => {
  const currentUser = useCurrentUser();
  const syncTick = useSyncDb();
  const isController = (['FRONT_DESK', 'BILLING_OFFICER', 'ADMINISTRATOR'] as const).includes(currentUser.role as any);

  const [query, setQuery] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  const [paymentSuccess, setPaymentSuccess] = useState<PaymentRecord | null>(null);

  // Part-payment dialog (amount + means/mode of payment)
  const [showPartPay, setShowPartPay] = useState(false);
  const [partAmount, setPartAmount] = useState<number>(0);
  const [partMethod, setPartMethod] = useState<PaymentRecord['paymentMethod']>('POS');
  const [partBank, setPartBank] = useState('');
  const [partRef, setPartRef] = useState('');

  // Receipt details dialog (click an individual receipt)
  const [receiptDetail, setReceiptDetail] = useState<{ receipt: PaymentRecord; invoice: Invoice } | null>(null);

  // Print-to dialog (select visits, or end-to-end, then print statement)
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  const [printVisitIds, setPrintVisitIds] = useState<string[]>([]);

  const [showAddBill, setShowAddBill] = useState(false);
  const [billTab, setBillTab] = useState<BillTab>('physician');
  const [staged, setStaged] = useState<Array<{ serviceCategory: Invoice['items'][0]['serviceCategory']; description: string; quantity: number; unitPrice: number }>>([]);
  const [pickServiceId, setPickServiceId] = useState('');
  const [pickQty, setPickQty] = useState(1);
  const [billingView, setBillingView] = useState<'per-visit' | 'end-to-end'>('per-visit');

  const settings = db.getSettings();
  const allInvoices = db.getInvoices();

  // live patient search by invoice no, name, hospital number, phone
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const patients = db.searchPatients(q);
    const byInvoice = allInvoices.filter(i => i.id.toLowerCase().includes(q)).map(i => db.getPatientById(i.patientId)).filter(Boolean) as Patient[];
    const merged = [...patients, ...byInvoice];
    const seen = new Set<string>();
    return merged.filter(p => (seen.has(p.id) ? false : (seen.add(p.id), true))).slice(0, 8);
  }, [query, syncTick]);

  const patientInvoices = selectedPatient ? db.getInvoices(selectedPatient.id) : [];
  const selectedInvoice = selectedInvoiceId ? db.getInvoiceById(selectedInvoiceId) : (patientInvoices.find(i => i.balance > 0) || patientInvoices[0] || null);
  const patientForInvoice = selectedPatient;

  // Visit status indicators
  const latestVisit = selectedPatient ? db.getVisits(selectedPatient.id)[0] : null;
  const visitLabs = latestVisit ? db.getLabRequests({ visitId: latestVisit.id }) : [];
  const visitRxs = latestVisit && selectedPatient ? db.getPrescriptions(selectedPatient.id, latestVisit.id) : [];
  const visitRad = latestVisit && selectedPatient ? db.getRadiologyOrders(selectedPatient.id, latestVisit.id) : [];
  const visitPhysio = latestVisit && selectedPatient ? db.getPhysiotherapyOrders(selectedPatient.id, latestVisit.id) : [];
  const hasLabResults = visitLabs.some(r => r.tests.some(t => ['Released', 'Verified'].includes(t.status)));
  const hasPendingLab = visitLabs.some(r => r.tests.some(t => !['Released', 'Verified'].includes(t.status)));
  const hasPrescriptions = visitRxs.length > 0;
  const hasDispensed = visitRxs.some(r => r.items.some(i => i.dispenseStatus === 'Dispensed'));
  const hasPendingDispense = visitRxs.some(r => r.items.some(i => i.dispenseStatus !== 'Dispensed'));
  const hasPhysio = visitPhysio.length > 0;
  const physioInProgress = visitPhysio.some(o => o.status === 'In Progress');



  useEffect(() => {
    if (filteredTotalBalance > 0) setPartAmount(filteredTotalBalance);
  }, [selectedInvoiceId, selectedPatient?.id, billingView, syncTick]);

  const handlePickPatient = (p: Patient) => {
    setSelectedPatient(p);
    setSelectedInvoiceId(null);
    setPaymentSuccess(null);
    setQuery(`${p.firstName} ${p.lastName} (${p.id})`);
  };

  // Per-visit vs end-to-end filtering
  const filteredInvoices = useMemo(() => {
    if (!selectedPatient) return [];
    if (billingView === 'end-to-end') return patientInvoices;
    // per-visit: group by visitDate, only show invoices from latest visit
    const latest = db.getVisits(selectedPatient.id)[0];
    if (!latest) return patientInvoices;
    return patientInvoices.filter(inv => inv.visitId === latest.id);
  }, [patientInvoices, billingView, selectedPatient?.id, syncTick]);

  const filteredTotalBilled = filteredInvoices.reduce((s, i) => s + i.total, 0);
  const filteredTotalPaid = filteredInvoices.reduce((s, i) => s + i.paidAmount, 0);
  const filteredTotalBalance = filteredInvoices.reduce((s, i) => s + i.balance, 0);

  // Push to nurse
  const handlePushToNurse = () => {
    if (!selectedPatient || !latestVisit) return;
    db.updateVisitStatus(latestVisit.id, 'With Nurse', currentUser);
  };

  // Check if patient has scheduled visits
  const hasScheduledVisit = selectedPatient ? db.getVisits(selectedPatient.id).some(v => v.status === 'Awaiting Vitals' || v.status === 'With Nurse') : false;

  // Part payment: amount + means/mode of payment, allocated oldest-first across
  // the currently viewed bills (per-visit or end-to-end). Full or partial allowed.
  const handleConfirmPartPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient || filteredInvoices.length === 0) return;
    if (!isController) { alert('Switch to Front Desk / Billing Officer role to collect payments.'); return; }
    const amount = Number(partAmount);
    if (!(amount > 0)) { alert('Enter an amount greater than zero.'); return; }
    if (amount > filteredTotalBalance) { alert(`Amount exceeds outstanding balance (${settings.currency}${filteredTotalBalance.toLocaleString()}).`); return; }
    try {
      let remaining = amount;
      const sorted = [...filteredInvoices].filter(i => i.balance > 0).sort((a, b) => a.date.localeCompare(b.date));
      let lastPmt: PaymentRecord | null = null;
      sorted.forEach(inv => {
        if (remaining <= 0) return;
        const pay = Math.min(inv.balance, remaining);
        lastPmt = db.recordPayment(inv.id, pay, partMethod, currentUser, partBank || undefined, partRef || undefined);
        remaining -= pay;
      });
      if (lastPmt) setPaymentSuccess(lastPmt);
      setShowPartPay(false);
      setPartBank('');
      setPartRef('');
    } catch (err: any) { alert(err.message); }
  };

  // add-bill dialog helpers — universal billing, single invoice per visit
  const visitIdForBill = selectedPatient ? (db.getVisits(selectedPatient.id)[0]?.id || `VST-${Date.now()}`) : '';
  const servicesForTab = useMemo(() => {
    const all = db.getServicePrices().filter(s => s.active);
    switch (billTab) {
      case 'physician': return all.filter(s => s.category === 'Consultation' || s.category === 'Other');
      case 'nursing': return all.filter(s => s.category === 'Nursing' || s.category === 'Procedure');
      case 'laboratory': {
        const labs = db.getLabInvestigations();
        return labs.map(l => ({ id: l.id, name: `${l.name} [${l.category}]`, category: 'Laboratory' as const, price: l.price, active: true, effectiveDate: '' } as any));
      }
      case 'pharmacy': {
        const meds = db.getMedications();
        return meds.map(m => ({ id: m.id, name: `${m.name} (${m.strength})`, category: 'Pharmacy' as const, price: m.unitPrice, active: true, effectiveDate: '' } as any));
      }
      case 'radiology': return all.filter(s => s.name.toLowerCase().includes('x-ray') || s.name.toLowerCase().includes('ultrasound') || s.name.toLowerCase().includes('ct ') || s.name.toLowerCase().includes('mri') || s.category === 'Procedure');
      case 'physiotherapy': return all.filter(s => s.name.toLowerCase().includes('physio') || s.name.toLowerCase().includes('rehab') || s.name.toLowerCase().includes('traction') || s.name.toLowerCase().includes('mobilization'));
      default: return all;
    }
  }, [billTab, syncTick]);

  useEffect(() => { setPickServiceId(servicesForTab[0]?.id || ''); }, [billTab]);

  const stagePick = () => {
    const svc: any = servicesForTab.find((s: any) => s.id === pickServiceId);
    if (!svc) return;
    setStaged(prev => [...prev, { serviceCategory: svc.category || 'Other', description: svc.name, quantity: pickQty, unitPrice: svc.price }]);
  };

  const confirmAddBill = () => {
    if (!selectedPatient || staged.length === 0) return;
    try {
      db.createFrontDeskBill(selectedPatient.id, visitIdForBill, staged, false, currentUser);
      setStaged([]);
      setShowAddBill(false);
    } catch (err: any) { alert(err.message); }
  };

  // Bill-type shortcuts: registration (first visit), consultation, antenatal, follow-up.
  // Each stages the matching fee from the Master Pricing Matrix (Admin-editable).
  const BILL_TYPE_PRESETS: Array<{ label: string; matchId: string; matchName: RegExp }> = [
    { label: 'Registration (First Visit)', matchId: 'SVC-008', matchName: /registr/i },
    { label: 'Consultation', matchId: 'SVC-001', matchName: /general physician consultation/i },
    { label: 'Antenatal', matchId: 'SVC-009', matchName: /antenat/i },
    { label: 'Follow-up Visit', matchId: 'SVC-010', matchName: /follow-up/i },
  ];

  const stageBillType = (preset: { label: string; matchId: string; matchName: RegExp }) => {
    const all = db.getServicePrices().filter(s => s.active);
    const svc = all.find(s => s.id === preset.matchId) || all.find(s => preset.matchName.test(s.name));
    if (!svc) { alert(`${preset.label} fee is not in the price list — ask Admin to add it under Master Pricing Matrix.`); return; }
    setStaged(prev => prev.some(x => x.description === svc.name) ? prev : [...prev, { serviceCategory: svc.category, description: svc.name, quantity: 1, unitPrice: svc.price }]);
  };

  return (
    <div className="h-full flex flex-col select-text overflow-hidden p-6 space-y-4">
      {/* Search only — header title removed */}
      <div className="flex items-center justify-center gap-4 border-b border-light-border dark:border-dark-border pb-4 flex-shrink-0">
        <div className="relative w-full max-w-2xl">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input value={query} onChange={e => { setQuery(e.target.value); setPaymentSuccess(null); }} placeholder="Search invoice #, name, hospital no, phone..." className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl bg-slate-50 dark:bg-dark-surface border text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none" />
          {query.trim() && searchResults.length > 0 && (
            <div className="absolute top-11 left-0 right-0 z-50 bg-white dark:bg-dark-card border rounded-xl shadow-xl overflow-hidden py-1 max-h-64 overflow-y-auto">
              {searchResults.map(p => (
                <div key={p.id} className="px-3 py-2 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 cursor-pointer flex items-center justify-between gap-2" onClick={() => handlePickPatient(p)}>
                  <div>
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100">{p.firstName} {p.lastName} <span className="font-mono text-[10px] text-emerald-600">({p.id})</span></div>
                    <div className="text-[11px] text-slate-500">{p.phone} • {p.sex}, {p.age}y</div>
                  </div>
                  {onOpenProfile && (
                    <button onClick={(e) => { e.stopPropagation(); onOpenProfile(p); }} className="px-2 py-1 rounded-lg text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex-shrink-0" title="Open Patient Profile">Profile</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {paymentSuccess && (
        <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-300 text-xs flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-2"><CheckCircle2 className="w-5 h-5 text-emerald-600" /><span className="font-bold">Payment confirmed — Receipt #{paymentSuccess.receiptNumber} • {settings.currency}{paymentSuccess.amount.toLocaleString()} • {paymentSuccess.paymentMethod}</span></div>
          <div className="flex items-center space-x-2">
            {selectedInvoice && patientForInvoice && <button onClick={() => pdfService.exportInvoice(selectedInvoice, patientForInvoice)} className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white border flex items-center space-x-1"><Printer className="w-3.5 h-3.5" /><span>Print</span></button>}
            <button onClick={() => setPaymentSuccess(null)} className="p-1.5 rounded-lg hover:bg-emerald-100 text-emerald-700" title="Dismiss receipt"><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {!selectedPatient ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 bg-white dark:bg-dark-card rounded-2xl border p-8 text-center">
          <Receipt className="w-10 h-10 mb-2 opacity-40" />
          <p className="font-bold text-sm">Search above to find a patient bill.</p>
          <p className="text-xs mt-1">Search by invoice number, patient name, hospital number or phone.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0">
          <div className="lg:col-span-7 flex flex-col space-y-3 overflow-y-auto pr-1 min-h-0">
            <div className="p-4 rounded-2xl bg-white dark:bg-dark-card border shadow-sm flex items-center justify-between flex-shrink-0">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center"><User className="w-5 h-5 text-emerald-600" /></div>
                <div>
                  <div className="font-extrabold text-sm text-slate-900 dark:text-white">{selectedPatient.firstName} {selectedPatient.lastName} <span className="font-mono text-[11px] text-emerald-600">({selectedPatient.id})</span></div>
                  <div className="text-[11px] text-slate-500">{selectedPatient.phone} • {patientInvoices.length} bill(s)</div>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {onOpenProfile && <button onClick={() => onOpenProfile(selectedPatient)} className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Profile</button>}
                <button onClick={() => { setPrintVisitIds(db.getVisits(selectedPatient.id).map(v => v.id)); setShowPrintDialog(true); }} className="px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 flex items-center space-x-1" title="Select visits and print statement"><Printer className="w-3.5 h-3.5" /><span>Print to</span></button>
                {latestVisit && ['Awaiting Vitals', 'With Nurse'].includes(latestVisit.status) && (
                  <button onClick={handlePushToNurse} className="px-3 py-1.5 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white flex items-center space-x-1">
                    <User className="w-3.5 h-3.5" /><span>Push to Nurse</span>
                  </button>
                )}
                <button onClick={() => { setStaged([]); setShowAddBill(true); }} className="px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white flex items-center space-x-1"><Plus className="w-3.5 h-3.5" /><span>Add Bill</span></button>
                <button onClick={() => { setPartAmount(filteredTotalBalance); setShowPartPay(true); }} disabled={filteredTotalBalance <= 0 || !isController} className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40 flex items-center space-x-1" title={isController ? 'Record part or full payment with means of payment' : 'Requires Front Desk role'}><Wallet className="w-3.5 h-3.5" /><span>Part Payment</span></button>
              </div>
            </div>

            {/* Visit Status Indicators */}
            {latestVisit && (
              <div className="p-3 rounded-2xl bg-white dark:bg-dark-card border shadow-sm flex-shrink-0">
                <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Latest Visit Status — {latestVisit.visitDate} ({latestVisit.status})</div>
                <div className="flex flex-wrap gap-2">
                  <div className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border ${hasLabResults ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : hasPendingLab ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                    <FlaskConical className="w-3.5 h-3.5" />
                    <span>{hasLabResults ? 'Lab Results Ready ✓' : hasPendingLab ? 'Lab Pending...' : 'No Lab Orders'}</span>
                  </div>
                  <div className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border ${hasDispensed ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : hasPendingDispense ? 'bg-amber-50 border-amber-200 text-amber-700' : hasPrescriptions ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                    <Pill className="w-3.5 h-3.5" />
                    <span>{hasDispensed ? 'Drugs Dispensed ✓' : hasPendingDispense ? 'Dispense Pending...' : hasPrescriptions ? 'Rx Prescribed' : 'No Prescriptions'}</span>
                  </div>
                  <div className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border ${physioInProgress ? 'bg-blue-50 border-blue-200 text-blue-700' : hasPhysio ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                    <HeartPulse className="w-3.5 h-3.5" />
                    <span>{physioInProgress ? 'Physio In Progress...' : hasPhysio ? 'Physio Completed ✓' : 'No Physio'}</span>
                  </div>
                  {visitRad.length > 0 && (
                    <div className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border ${visitRad.some(o => o.status === 'Completed') ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                      <Radio className="w-3.5 h-3.5" />
                      <span>{visitRad.some(o => o.status === 'Completed') ? 'Radiology Done ✓' : 'Radiology Pending...'}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between bg-white dark:bg-dark-card rounded-2xl border shadow-sm px-3 py-2 flex-shrink-0">
              <div className="flex items-center space-x-1">
                <button onClick={() => setBillingView('per-visit')} className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${billingView === 'per-visit' ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-slate-50 text-slate-500 border border-transparent hover:bg-slate-100'}`}>Per Visit</button>
                <button onClick={() => setBillingView('end-to-end')} className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${billingView === 'end-to-end' ? 'bg-blue-100 text-blue-800 border border-blue-300' : 'bg-slate-50 text-slate-500 border border-transparent hover:bg-slate-100'}`}>End-to-End</button>
              </div>
              {hasScheduledVisit && <span className="text-[10px] font-bold text-purple-600 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full">Scheduled Visit Active</span>}
            </div>

            <div className="grid grid-cols-3 gap-2 flex-shrink-0">
              <div className="p-3 rounded-xl bg-white dark:bg-dark-card border text-center"><div className="text-[10px] font-bold text-slate-400 uppercase">Total Billed</div><div className="font-extrabold text-sm">{settings.currency}{filteredTotalBilled.toLocaleString()}</div></div>
              <div className="p-3 rounded-xl bg-white dark:bg-dark-card border text-center"><div className="text-[10px] font-bold text-slate-400 uppercase">Total Paid</div><div className="font-extrabold text-sm text-emerald-600">{settings.currency}{filteredTotalPaid.toLocaleString()}</div></div>
              <div className={`p-3 rounded-xl border text-center ${filteredTotalBalance > 0 ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-200'}`}><div className="text-[10px] font-bold text-slate-400 uppercase">Balance</div><div className={`font-black text-sm ${filteredTotalBalance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{settings.currency}{filteredTotalBalance.toLocaleString()}</div></div>
            </div>

            <div className="bg-white dark:bg-dark-card rounded-2xl border shadow-sm flex flex-col max-h-[420px] min-h-[220px] flex-shrink-0">
              <div className="px-4 py-2.5 border-b bg-slate-50 font-bold text-xs flex items-center justify-between flex-shrink-0">
                <span>Bills ({filteredInvoices.length}) — {billingView === 'per-visit' ? 'Latest Visit' : 'All Visits'}</span>
                <span className={`text-[11px] font-extrabold ${filteredTotalBalance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>Balance: {settings.currency}{filteredTotalBalance.toLocaleString()}</span>
              </div>
              <div className="flex-1 overflow-y-auto divide-y max-h-[320px] min-h-[120px]">
                {filteredInvoices.length === 0 ? <div className="p-6 text-center text-xs text-slate-400">No bills {billingView === 'per-visit' ? 'for this visit' : 'for this patient'} yet. Use Add Bill.</div> :
                  filteredInvoices.map(inv => (
                    <div key={inv.id} onClick={() => setSelectedInvoiceId(inv.id)} className={`p-3 flex items-center justify-between cursor-pointer hover:bg-slate-50 ${selectedInvoice?.id === inv.id ? 'bg-emerald-50/60' : ''}`}>
                      <div><div className="font-mono font-bold text-xs">{inv.id} <span className="text-[10px] text-slate-400">• {inv.date} • {inv.items.length} items</span></div><div className="text-[11px] text-slate-500">Total {settings.currency}{inv.total.toLocaleString()} • Paid {settings.currency}{inv.paidAmount.toLocaleString()} • Bal {settings.currency}{inv.balance.toLocaleString()}</div></div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${inv.paymentStatus === 'Paid' ? 'bg-emerald-100 text-emerald-700' : inv.paymentStatus === 'Partially Paid' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{inv.paymentStatus}</span>
                    </div>
                  ))}
              </div>
            </div>

            {selectedInvoice && (
              <div className="bg-white dark:bg-dark-card rounded-2xl border shadow-sm flex flex-col max-h-[380px] flex-shrink-0">
                <div className="px-4 py-2 border-b bg-slate-50 font-bold text-xs flex-shrink-0">Details: {selectedInvoice.id} ({selectedInvoice.items.length} items)</div>
                <div className="overflow-y-auto max-h-[260px] divide-y">
                  {selectedInvoice.items.map(it => (
                    <div key={it.id} className="px-4 py-2 flex justify-between text-xs"><span><span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 mr-2">{it.serviceCategory}</span>{it.description} <span className="text-slate-400">x{it.quantity}</span></span><span className="font-mono font-bold">{settings.currency}{it.totalPrice.toLocaleString()}</span></div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-5 flex flex-col space-y-3 overflow-y-auto min-h-0">
            <div className="p-5 rounded-2xl bg-white dark:bg-dark-card border shadow-sm flex-shrink-0">
              <div className="flex items-center justify-between border-b pb-3 mb-3">
                <h3 className="text-sm font-extrabold">Billing Summary</h3>
                <button onClick={() => { setPartAmount(filteredTotalBalance); setShowPartPay(true); }} disabled={filteredTotalBalance <= 0 || !isController} className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40 flex items-center space-x-1"><Wallet className="w-3.5 h-3.5" /><span>Part Payment</span></button>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="p-2.5 rounded-xl bg-slate-50 border"><div className="text-[10px] font-bold text-slate-400 uppercase">Billed</div><div className="font-extrabold">{settings.currency}{filteredTotalBilled.toLocaleString()}</div></div>
                <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200"><div className="text-[10px] font-bold text-slate-400 uppercase">Paid</div><div className="font-extrabold text-emerald-600">{settings.currency}{filteredTotalPaid.toLocaleString()}</div></div>
                <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200"><div className="text-[10px] font-bold text-slate-400 uppercase">Balance</div><div className="font-extrabold text-rose-600">{settings.currency}{filteredTotalBalance.toLocaleString()}</div></div>
              </div>
              <p className="text-[11px] text-slate-500 mt-3">Use <strong>Part Payment</strong> to record any amount (full or partial) with its means of payment — POS, Transfer, Cash, Card or Insurance. Payments apply oldest-first across the viewed bills and each issues an official receipt.</p>
              {!isController && <p className="text-[11px] font-bold text-amber-600 mt-2">Read-only: requires Front Desk / Billing Officer role to collect payments.</p>}
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-dark-card border shadow-sm flex flex-col max-h-[300px] flex-shrink-0">
              <div className="font-bold text-xs mb-1">Receipts ({selectedInvoice?.payments.length || 0})</div>
              <p className="text-[10px] text-slate-400 mb-2">Click a receipt to see details & print (A4 or thermal POS).</p>
              <div className="overflow-y-auto space-y-2 max-h-[220px]">
                {selectedInvoice?.payments.map(p => (
                  <div key={p.id} onClick={() => setReceiptDetail({ receipt: p, invoice: selectedInvoice })} className="p-2 rounded-xl bg-slate-50 border text-xs cursor-pointer hover:border-emerald-400 hover:shadow-sm transition-all" title="View receipt details & print">
                    <div className="flex justify-between font-bold"><span className="font-mono text-emerald-600">{p.receiptNumber}</span><span className="font-mono">{settings.currency}{p.amount.toLocaleString()}</span></div>
                    <div className="text-[11px] text-slate-500">{p.paymentMethod} • {new Date(p.paidAt).toLocaleDateString()}</div>
                  </div>
                ))}
                {(!selectedInvoice || selectedInvoice.payments.length === 0) && <div className="text-xs text-slate-400 text-center p-4">No receipts yet.</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddBill && selectedPatient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setShowAddBill(false)} />
          <div className="relative bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-2xl border max-h-[90vh] flex flex-col">
            <div className="px-5 py-4 border-b flex items-center justify-between"><h3 className="font-extrabold text-sm">Add Bill — {selectedPatient.firstName} {selectedPatient.lastName} ({selectedPatient.id})</h3><button onClick={() => setShowAddBill(false)} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button></div>
            <div className="px-5 pt-3 flex flex-wrap items-center gap-1.5 flex-shrink-0">
              <span className="text-[11px] font-bold text-slate-500">Bill type:</span>
              {BILL_TYPE_PRESETS.map(b => (
                <button key={b.label} onClick={() => stageBillType(b)} className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200">{b.label}</button>
              ))}
            </div>
            <div className="px-5 pt-3 flex space-x-1.5 overflow-x-auto flex-shrink-0">
              {BILL_TABS.map(t => (
                <button key={t.id} onClick={() => setBillTab(t.id)} className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold flex-shrink-0 ${billTab === t.id ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{t.icon}<span>{t.label}</span></button>
              ))}
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <div className="flex gap-2">
                <select value={pickServiceId} onChange={e => setPickServiceId(e.target.value)} className="flex-1 px-3 py-2 text-xs rounded-xl bg-slate-50 border">
                  {servicesForTab.map((s: any) => <option key={s.id} value={s.id}>{s.name} • {settings.currency}{s.price.toLocaleString()}</option>)}
                </select>
                <input type="number" min={1} value={pickQty} onChange={e => setPickQty(Math.max(1, Number(e.target.value)))} className="w-16 px-2 py-2 text-xs rounded-xl bg-slate-50 border text-center" />
                <button onClick={stagePick} className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white flex items-center space-x-1"><Plus className="w-3.5 h-3.5" /><span>Add</span></button>
              </div>
              {staged.length > 0 && <div className="space-y-1.5">{staged.map((s, i) => <div key={i} className="flex justify-between p-2 rounded-xl bg-slate-50 border text-xs"><span className="font-bold">{s.description} x{s.quantity} — {settings.currency}{(s.unitPrice * s.quantity).toLocaleString()}</span><button onClick={() => setStaged(prev => prev.filter((_, idx) => idx !== i))} className="text-rose-500"><X className="w-3 h-3" /></button></div>)}</div>}
              <p className="text-[11px] text-slate-400">Universal billing: items merge into the single visit invoice — no double billing. Use Bill type for registration (first visit), consultation, antenatal or follow-up fees; tabs cover all other services.</p>
            </div>
            <div className="px-5 py-3 bg-slate-50 rounded-b-2xl flex justify-between items-center flex-shrink-0">
              <span className="text-xs font-bold">{staged.length} item(s) • {settings.currency}{staged.reduce((s, x) => s + x.unitPrice * x.quantity, 0).toLocaleString()}</span>
              <div className="flex space-x-2"><button onClick={() => setShowAddBill(false)} className="px-4 py-2 rounded-xl text-xs font-bold border">Cancel</button><button onClick={confirmAddBill} disabled={staged.length === 0} className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white disabled:opacity-40">Confirm Bill</button></div>
            </div>
          </div>
        </div>
      )}

      {showPartPay && selectedPatient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setShowPartPay(false)} />
          <form onSubmit={handleConfirmPartPayment} className="relative bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-md border p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="font-extrabold text-sm">Part Payment — {selectedPatient.firstName} {selectedPatient.lastName}</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">Outstanding ({billingView === 'per-visit' ? 'latest visit' : 'all visits'}): <strong>{settings.currency}{filteredTotalBalance.toLocaleString()}</strong></p>
              </div>
              <button type="button" onClick={() => setShowPartPay(false)} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div>
              <label className="block font-bold mb-1">Amount to pay ({settings.currency}):</label>
              <input type="number" required min={1} max={filteredTotalBalance} value={partAmount} onChange={e => setPartAmount(Number(e.target.value))} className="w-full px-3 py-2 rounded-xl bg-slate-50 border font-mono font-extrabold text-base" placeholder="e.g. 5000" />
              <p className="text-[10px] text-slate-400 mt-1">Pay in full or in part — any amount up to the outstanding balance.</p>
            </div>
            <div>
              <label className="block font-bold mb-1">Means / mode of payment:</label>
              <select value={partMethod} onChange={e => setPartMethod(e.target.value as any)} className="w-full px-3 py-2 rounded-xl bg-slate-50 border font-bold">
                <option value="POS">POS Terminal</option>
                <option value="Transfer">Bank Transfer</option>
                <option value="Cash">Cash at Counter</option>
                <option value="Card">Card / Online</option>
                <option value="Insurance">HMO / Insurance</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input value={partBank} onChange={e => setPartBank(e.target.value)} placeholder="Bank (optional)" className="px-3 py-2 text-xs rounded-xl bg-slate-50 border" />
              <input value={partRef} onChange={e => setPartRef(e.target.value)} placeholder="Ref / RRV (optional)" className="px-3 py-2 text-xs font-mono rounded-xl bg-slate-50 border" />
            </div>
            <div className="flex justify-end space-x-2 pt-2">
              <button type="button" onClick={() => setShowPartPay(false)} className="px-4 py-2 rounded-xl text-xs font-bold border">Cancel</button>
              <button type="submit" disabled={filteredTotalBalance <= 0 || !isController} className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40">Confirm & Issue Receipt</button>
            </div>
          </form>
        </div>
      )}

      {/* Receipt Details Dialog — view + print (A4 or thermal POS) */}
      {receiptDetail && selectedPatient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setReceiptDetail(null)} />
          <div className="relative bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-md border p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center space-x-2">
                <Receipt className="w-5 h-5 text-emerald-600" />
                <div>
                  <h3 className="font-extrabold text-sm">Receipt {receiptDetail.receipt.receiptNumber}</h3>
                  <p className="text-[11px] text-slate-500">{selectedPatient.firstName} {selectedPatient.lastName} ({selectedPatient.id}) • Invoice {receiptDetail.invoice.id}</p>
                </div>
              </div>
              <button onClick={() => setReceiptDetail(null)} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="rounded-xl bg-slate-50 border divide-y text-xs">
              <div className="px-3 py-2 flex justify-between"><span className="text-slate-500">Amount received</span><strong className="font-mono text-emerald-600 text-sm">{settings.currency}{receiptDetail.receipt.amount.toLocaleString()}</strong></div>
              <div className="px-3 py-2 flex justify-between"><span className="text-slate-500">Means of payment</span><strong>{receiptDetail.receipt.paymentMethod}</strong></div>
              {receiptDetail.receipt.bankName && <div className="px-3 py-2 flex justify-between"><span className="text-slate-500">Bank</span><strong>{receiptDetail.receipt.bankName}</strong></div>}
              {receiptDetail.receipt.transactionReference && <div className="px-3 py-2 flex justify-between"><span className="text-slate-500">Reference</span><strong className="font-mono">{receiptDetail.receipt.transactionReference}</strong></div>}
              <div className="px-3 py-2 flex justify-between"><span className="text-slate-500">Received by</span><strong>{receiptDetail.receipt.receivedBy}</strong></div>
              <div className="px-3 py-2 flex justify-between"><span className="text-slate-500">Date / time</span><strong>{new Date(receiptDetail.receipt.paidAt).toLocaleString()}</strong></div>
              <div className="px-3 py-2 flex justify-between"><span className="text-slate-500">Invoice total</span><strong className="font-mono">{settings.currency}{receiptDetail.invoice.total.toLocaleString()}</strong></div>
              <div className="px-3 py-2 flex justify-between"><span className="text-slate-500">Total paid</span><strong className="font-mono text-emerald-600">{settings.currency}{receiptDetail.invoice.paidAmount.toLocaleString()}</strong></div>
              <div className="px-3 py-2 flex justify-between"><span className="text-slate-500">Balance</span><strong className="font-mono text-rose-600">{settings.currency}{receiptDetail.invoice.balance.toLocaleString()}</strong></div>
            </div>
            <div className="flex justify-end space-x-2 pt-1">
              <button onClick={() => setReceiptDetail(null)} className="px-4 py-2 rounded-xl text-xs font-bold border">Close</button>
              <button onClick={() => pdfService.exportReceipt(receiptDetail.invoice, receiptDetail.receipt, selectedPatient)} className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white flex items-center space-x-1"><Printer className="w-3.5 h-3.5" /><span>Print (A4)</span></button>
              <button onClick={() => pdfService.exportThermalReceipt(receiptDetail.invoice, receiptDetail.receipt, selectedPatient)} className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-900 text-white flex items-center space-x-1"><Receipt className="w-3.5 h-3.5" /><span>Thermal POS</span></button>
            </div>
          </div>
        </div>
      )}

      {/* Print-to Dialog — tick visits (as many as needed) or end-to-end, then print */}
      {showPrintDialog && selectedPatient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setShowPrintDialog(false)} />
          <div className="relative bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-md border flex flex-col max-h-[85vh]">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-sm">Print to — {selectedPatient.firstName} {selectedPatient.lastName}</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">Tick visits to include, or print end-to-end (all visits).</p>
              </div>
              <button onClick={() => setShowPrintDialog(false)} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-1.5 overflow-y-auto">
              {db.getVisits(selectedPatient.id).length === 0 && (
                <div className="text-xs text-slate-400 text-center p-4">No visits on record for this patient.</div>
              )}
              {db.getVisits(selectedPatient.id).map(v => {
                const checked = printVisitIds.includes(v.id);
                const inv = db.getInvoices(selectedPatient.id, v.id)[0];
                return (
                  <div
                    key={v.id}
                    onClick={() => setPrintVisitIds(prev => (prev.includes(v.id) ? prev.filter(id => id !== v.id) : [...prev, v.id]))}
                    className={`px-3 py-2.5 rounded-xl border text-xs flex items-center justify-between gap-2 cursor-pointer transition-all ${checked ? 'bg-blue-50 border-blue-400 shadow-sm' : 'bg-slate-50 border-slate-200 hover:border-blue-300'}`}
                  >
                    <div className="flex items-center space-x-2 min-w-0">
                      <input type="checkbox" readOnly checked={checked} className="w-4 h-4 rounded text-blue-600 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="font-bold">{v.visitDate} • {v.visitType} • {v.status}</div>
                        <div className="text-[11px] text-slate-500 truncate">{v.reasonForVisit || 'General'} {inv ? `• Billed ${settings.currency}${inv.total.toLocaleString()}` : '• Not billed'}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="px-5 py-3 bg-slate-50 rounded-b-2xl flex items-center justify-between flex-shrink-0">
              <div className="flex space-x-2">
                <button onClick={() => setPrintVisitIds(db.getVisits(selectedPatient.id).map(v => v.id))} className="px-3 py-2 rounded-xl text-xs font-bold border bg-white">End-to-End (all)</button>
                <button onClick={() => setPrintVisitIds([])} className="px-3 py-2 rounded-xl text-xs font-bold border bg-white">Clear</button>
              </div>
              <button
                onClick={() => {
                  const visits = db.getVisits(selectedPatient.id).filter(v => printVisitIds.includes(v.id));
                  if (visits.length === 0) { alert('Tick at least one visit to print.'); return; }
                  const invoices = patientInvoices.filter(i => printVisitIds.includes(i.visitId));
                  pdfService.exportVisitStatement(selectedPatient, visits, invoices);
                  setShowPrintDialog(false);
                }}
                disabled={printVisitIds.length === 0}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 flex items-center space-x-1"
              >
                <Printer className="w-3.5 h-3.5" /><span>Print ({printVisitIds.length})</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
