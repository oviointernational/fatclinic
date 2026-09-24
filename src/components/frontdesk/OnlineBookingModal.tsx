import React, { useState } from 'react';
import { db } from '../../services/db';
import { OnlineBooking } from '../../types';
import { 
  X, 
  Calendar, 
  Clock, 
  User, 
  Phone, 
  Mail, 
  MapPin, 
  FileText, 
  CheckCircle2, 
  Copy, 
  Activity, 
  ArrowRight 
} from 'lucide-react';

interface OnlineBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBookingCreated?: (booking: OnlineBooking) => void;
}

export const OnlineBookingModal: React.FC<OnlineBookingModalProps> = ({
  isOpen,
  onClose,
  onBookingCreated
}) => {
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('1995-01-01');
  const [age, setAge] = useState<number>(31);
  const [sex, setSex] = useState<'Male' | 'Female' | 'Other'>('Female');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [reason, setReason] = useState('');
  const [preferredDate, setPreferredDate] = useState(new Date().toISOString().split('T')[0]);
  const [preferredTime, setPreferredTime] = useState('09:30');

  const [confirmedBooking, setConfirmedBooking] = useState<OnlineBooking | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !phone.trim() || !reason.trim()) {
      alert('Please fill in all required fields (First Name, Last Name, Phone Number, and Reason for Appointment).');
      return;
    }

    const created = db.createOnlineBooking({
      firstName: firstName.trim(),
      middleName: middleName.trim() || undefined,
      lastName: lastName.trim(),
      dob,
      age: Number(age) || 30,
      sex,
      phone: phone.trim(),
      email: email.trim() || undefined,
      address: address.trim() || 'Not specified',
      reasonForAppointment: reason.trim(),
      preferredDate,
      preferredTime
    });

    setConfirmedBooking(created);
    if (onBookingCreated) onBookingCreated(created);
  };

  const handleCopyCode = () => {
    if (confirmedBooking) {
      navigator.clipboard.writeText(confirmedBooking.patientCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const handleResetAndClose = () => {
    setConfirmedBooking(null);
    setFirstName('');
    setMiddleName('');
    setLastName('');
    setPhone('');
    setEmail('');
    setAddress('');
    setReason('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto select-text animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border rounded-3xl shadow-2xl overflow-hidden my-6">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-light-border dark:border-dark-border flex items-center justify-between bg-slate-50 dark:bg-dark-surface/50">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                Book Patient Appointment & Self Pre-Registration
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Register yourself online. Receive your Patient Code for rapid check-in at Front Desk.
              </p>
            </div>
          </div>
          <button 
            onClick={handleResetAndClose}
            className="p-1.5 rounded-xl hover:bg-slate-200 dark:hover:bg-dark-border text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {confirmedBooking ? (
            <div className="text-center py-6 space-y-6 animate-in zoom-in-95 duration-200">
              <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto shadow-inner">
                <CheckCircle2 className="w-9 h-9" />
              </div>

              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  Appointment Booked & Pre-Registration Saved
                </span>
                <h2 className="text-xl font-black text-slate-900 dark:text-white mt-1">
                  Welcome, {confirmedBooking.firstName} {confirmedBooking.lastName}!
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
                  Your appointment request for <strong>{confirmedBooking.preferredDate} at {confirmedBooking.preferredTime}</strong> has been transmitted directly to our Front Desk.
                </p>
              </div>

              {/* Code Highlight Box */}
              <div className="p-6 rounded-3xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/30 border border-emerald-300 dark:border-emerald-800 max-w-md mx-auto shadow-sm">
                <div className="text-[11px] font-extrabold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
                  Your Official Patient Check-in Code:
                </div>
                <div className="text-4xl font-black font-mono tracking-wider text-slate-900 dark:text-white my-3 flex items-center justify-center space-x-3">
                  <span>{confirmedBooking.patientCode}</span>
                  <button
                    onClick={handleCopyCode}
                    className="p-2 rounded-xl bg-white dark:bg-dark-card border border-emerald-300 dark:border-emerald-700 hover:bg-emerald-50 text-slate-600 dark:text-slate-300 transition-all text-xs"
                    title="Copy Patient Code"
                  >
                    {copiedCode ? <span className="text-emerald-600 font-bold">Copied!</span> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                  When you arrive at <strong>FatClinic</strong>, simply present this <strong>Patient Code</strong> to the Front Desk officer to immediately pull up your record, finalize registration, and proceed to clinical triage.
                </p>
              </div>

              <div className="flex items-center justify-center space-x-3 pt-2">
                <button
                  onClick={handleResetAndClose}
                  className="px-6 py-2.5 rounded-xl text-xs font-extrabold bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg transition-all"
                >
                  Done / Proceed to Clinic
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    First Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    placeholder="e.g. Zainab"
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    Middle Name
                  </label>
                  <input
                    type="text"
                    value={middleName}
                    onChange={e => setMiddleName(e.target.value)}
                    placeholder="Optional"
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    Last Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    placeholder="e.g. Mustapha"
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    Date of Birth
                  </label>
                  <input
                    type="date"
                    value={dob}
                    onChange={e => {
                      setDob(e.target.value);
                      const birthYear = new Date(e.target.value).getFullYear();
                      if (birthYear) setAge(new Date().getFullYear() - birthYear);
                    }}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    Age (Years)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="130"
                    value={age}
                    onChange={e => setAge(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    Sex
                  </label>
                  <select
                    value={sex}
                    onChange={e => setSex(e.target.value as any)}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  >
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    Phone Number *
                  </label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="+234 800 000 0000"
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="patient@example.com"
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                  Residential Address
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  placeholder="Street name, City, State"
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    Preferred Visit Date
                  </label>
                  <input
                    type="date"
                    required
                    value={preferredDate}
                    onChange={e => setPreferredDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    Preferred Time
                  </label>
                  <input
                    type="time"
                    required
                    value={preferredTime}
                    onChange={e => setPreferredTime(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                  Reason for Appointment / Medical Complaints *
                </label>
                <textarea
                  required
                  rows={2}
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Describe your current symptoms, medical reasons, or consultation request..."
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-light-border dark:border-dark-border">
                <button
                  type="button"
                  onClick={handleResetAndClose}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-dark-surface"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex items-center space-x-2 px-6 py-2.5 rounded-xl text-xs font-extrabold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md transition-all"
                >
                  <span>Submit & Get Patient Code</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
