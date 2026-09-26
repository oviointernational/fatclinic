import React, { useState } from 'react';
import { db } from '../../services/db';
import { useCurrentUser } from '../../context/AuthContext';
import { useSyncDb } from '../../hooks/useSyncDb';
import { OnlineBooking, Patient } from '../../types';
import {
  Globe,
  Search,
  CheckCircle2,
  UserCheck,
  User,
  X
} from 'lucide-react';

interface OnlineBookingsLookupProps {
  onPatientRegistered?: (patient: Patient) => void;
  onOpenProfile?: (patient: Patient) => void;
}

export const OnlineBookingsLookup: React.FC<OnlineBookingsLookupProps> = ({
  onPatientRegistered,
  onOpenProfile
}) => {
  const currentUser = useCurrentUser();
  useSyncDb();
  const [codeQuery, setCodeQuery] = useState('');
  const [selectedBooking, setSelectedBooking] = useState<OnlineBooking | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [dialogPatient, setDialogPatient] = useState<Patient | null>(null);

  const bookings = db.getOnlineBookings();
  const pendingBookings = bookings.filter(b => b.status === 'Pending Arrival');

  const filteredBookings = bookings.filter(b => {
    if (!codeQuery.trim()) return true;
    const q = codeQuery.toLowerCase();
    return (
      b.patientCode.toLowerCase().includes(q) ||
      `${b.firstName} ${b.lastName}`.toLowerCase().includes(q) ||
      b.phone.includes(q)
    );
  });

  const handleLookupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeQuery.trim()) return;
    const found = db.getOnlineBookingByCode(codeQuery.trim());
    if (found) {
      setSelectedBooking(found);
    } else {
      alert(`No online pre-registration found with Patient Code "${codeQuery.trim()}".`);
    }
  };

  const handleFinalizeRegistration = (booking: OnlineBooking) => {
    try {
      const { patient, visit } = db.convertBookingToPatient(booking.id, currentUser);
      setSuccessMessage(`Patient successfully enrolled! Hospital No: ${patient.id}. Visit started.`);
      setSelectedBooking(null);
      setTimeout(() => {
        setSuccessMessage(null);
        if (onPatientRegistered) onPatientRegistered(patient);
      }, 1500);
    } catch (err: any) {
      alert(`Error finalizing registration: ${err.message}`);
    }
  };

  const openBookingDialog = (b: OnlineBooking) => {
    setSelectedBooking(b);
    // If booking already converted, resolve linked patient and show profile dialog
    const linked = db.getPatients().find(p => p.phone === b.phone && p.firstName.toLowerCase() === b.firstName.toLowerCase());
    if (linked && onOpenProfile) {
      setDialogPatient(linked);
    } else if (linked) {
      setDialogPatient(linked);
    } else {
      setDialogPatient(null);
    }
  };

  return (
    <div className="h-full flex flex-col select-text overflow-hidden p-6 space-y-5">
      {/* Compact control bar: count + code check-in */}
      <div className="rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex flex-wrap items-center gap-2 p-3 flex-shrink-0">
        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 px-1">
          {filteredBookings.length} booking{filteredBookings.length === 1 ? '' : 's'}
        </span>
        <form onSubmit={handleLookupSubmit} className="flex items-center space-x-2 flex-1 min-w-[220px]">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={codeQuery}
              onChange={e => setCodeQuery(e.target.value)}
              placeholder="Enter Patient Code (e.g. REG-8492)..."
              className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-xs font-mono font-bold text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 rounded-xl text-xs font-extrabold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all flex-shrink-0"
          >
            Check In Code
          </button>
        </form>
      </div>

      {successMessage && (
        <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Selected Booking — dialog view (click any patient opens dialog) */}
      {selectedBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => { setSelectedBooking(null); setDialogPatient(null); }} />
          <div className="relative bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-2xl border max-h-[90vh] overflow-y-auto">
          <div className="px-5 py-4 border-b flex items-center justify-between sticky top-0 bg-white dark:bg-dark-card">
            <h3 className="font-extrabold text-sm">Online Booking — {selectedBooking.patientCode}</h3>
            <button onClick={() => { setSelectedBooking(null); setDialogPatient(null); }} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button>
          </div>
          <div className="p-5 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <span className="text-xs font-extrabold px-3 py-1 rounded-xl bg-purple-600 text-white font-mono tracking-wider">
                Code: {selectedBooking.patientCode}
              </span>
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                {selectedBooking.firstName} {selectedBooking.middleName || ''} {selectedBooking.lastName}
              </h3>
              <span className="text-xs text-slate-500">
                ({selectedBooking.sex} • {selectedBooking.age} yrs • DOB: {selectedBooking.dob})
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setSelectedBooking(null)}
                className="px-3 py-1.5 rounded-xl text-xs text-slate-500 hover:bg-slate-200/50 dark:hover:bg-dark-surface font-semibold"
              >
                Close
              </button>
              {selectedBooking.status === 'Pending Arrival' && (
                <button
                  onClick={() => handleFinalizeRegistration(selectedBooking)}
                  className="flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-extrabold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md transition-all"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>Complete Registration & Start Visit</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-600 dark:text-slate-300">
            <div><strong>Phone:</strong> {selectedBooking.phone}</div>
            <div><strong>Email:</strong> {selectedBooking.email || 'N/A'}</div>
            <div><strong>Preferred Date:</strong> {selectedBooking.preferredDate} ({selectedBooking.preferredTime})</div>
            <div className="sm:col-span-3"><strong>Address:</strong> {selectedBooking.address}</div>
            <div className="sm:col-span-3"><strong>Reason for Visit:</strong> {selectedBooking.reasonForAppointment}</div>
          </div>
          {dialogPatient && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 text-xs flex items-center justify-between">
              <span className="font-bold text-emerald-700">Linked patient: {dialogPatient.firstName} {dialogPatient.lastName} ({dialogPatient.id})</span>
              {onOpenProfile && <button onClick={() => onOpenProfile(dialogPatient)} className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 text-white flex items-center space-x-1"><User className="w-3.5 h-3.5" /><span>Open Profile</span></button>}
            </div>
          )}
          </div>
          </div>
        </div>
      )}

      {/* Bookings Table */}
      <div className="flex-1 bg-white dark:bg-dark-card rounded-2xl border border-light-border dark:border-dark-border overflow-hidden flex flex-col shadow-sm">
        <div className="px-5 py-3 border-b border-light-border dark:border-dark-border bg-slate-50 dark:bg-dark-surface/50 flex items-center justify-between text-xs font-bold">
          <span className="text-slate-700 dark:text-slate-300">
            Online Bookings Queue ({pendingBookings.length} awaiting check-in)
          </span>
          <span className="text-[11px] text-slate-400">
            Click any row to review & check in
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredBookings.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-slate-400 text-xs">
              <Globe className="w-8 h-8 mb-2 opacity-40 text-purple-500" />
              <span>No online bookings match the search criteria.</span>
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-light-border dark:border-dark-border bg-slate-50/70 dark:bg-dark-surface/30 text-slate-400 text-[10px] font-extrabold uppercase tracking-wider">
                  <th className="py-3 px-4">Patient Code</th>
                  <th className="py-3 px-4">Patient Name</th>
                  <th className="py-3 px-4">Contact Info</th>
                  <th className="py-3 px-4">Appointment Slot</th>
                  <th className="py-3 px-4">Clinical Reason</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-light-border dark:divide-dark-border">
                {filteredBookings.map(b => {
                  const isPending = b.status === 'Pending Arrival';

                  return (
                    <tr
                      key={b.id}
                      onClick={() => openBookingDialog(b)}
                      title="Click to view patient as dialog"
                      className="hover:bg-purple-50/60 dark:hover:bg-purple-950/20 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 font-mono font-extrabold text-purple-600 dark:text-purple-400">
                        {b.patientCode}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-extrabold text-slate-900 dark:text-white">
                          {b.firstName} {b.lastName}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {b.sex} • {b.age} yrs
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        <div>{b.phone}</div>
                        {b.email && <div className="text-[10px] text-slate-400">{b.email}</div>}
                      </td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                        <div className="font-semibold">{b.preferredDate}</div>
                        <div className="text-[10px] text-slate-400">{b.preferredTime}</div>
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300 max-w-xs truncate">
                        {b.reasonForAppointment}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                          isPending 
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' 
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                        }`}>
                          {b.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {isPending ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleFinalizeRegistration(b);
                            }}
                            className="px-3 py-1 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all"
                          >
                            Check In
                          </button>
                        ) : (
                          <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center justify-end space-x-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Enrolled</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
