import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../services/db';
import { Patient } from '../../types';
import { UserPlus, X, Check, AlertCircle } from 'lucide-react';

interface PatientRegistrationProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (patient: Patient) => void;
}

export const PatientRegistration: React.FC<PatientRegistrationProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const { currentUser } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('1995-01-01');
  const [age, setAge] = useState<number>(31);
  const [sex, setSex] = useState<Patient['sex']>('Female');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [nextOfKin, setNextOfKin] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [occupation, setOccupation] = useState('');
  const [bloodGroup, setBloodGroup] = useState('O Positive');
  const [genotype, setGenotype] = useState('AA');
  const [allergiesText, setAllergiesText] = useState('');
  const [alertsText, setAlertsText] = useState('');

  if (!isOpen) return null;

  const handleDobChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDob(val);
    if (val) {
      const birthYear = new Date(val).getFullYear();
      const currentYear = new Date().getFullYear();
      setAge(Math.max(0, currentYear - birthYear));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName || !lastName || !phone) return;

    const allergies = allergiesText
      ? allergiesText.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const alerts = alertsText
      ? alertsText.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const newPatient = db.registerPatient({
      firstName,
      middleName: middleName || undefined,
      lastName,
      dob,
      age: Number(age),
      sex,
      phone,
      email: email || undefined,
      address,
      nextOfKin,
      emergencyContact: emergencyContact || phone,
      occupation: occupation || undefined,
      bloodGroup,
      genotype,
      allergies,
      alerts
    }, currentUser);

    onSuccess(newPatient);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border rounded-3xl shadow-2xl overflow-hidden select-text animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-light-border dark:border-dark-border flex items-center justify-between bg-slate-50 dark:bg-dark-surface/50">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <UserPlus className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-800 dark:text-white">
                Register New Patient
              </h3>
              <p className="text-xs text-slate-500">
                Front desk intake • Patient ID will be automatically generated
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-surface"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto max-h-[75vh] space-y-4 text-xs">
          
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 border-b border-light-border dark:border-dark-border pb-1">
            1. Personal Demographics
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">First Name *</label>
              <input
                type="text"
                required
                placeholder="e.g. Oluwaseun"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Middle Name</label>
              <input
                type="text"
                placeholder="e.g. Babatunde"
                value={middleName}
                onChange={e => setMiddleName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Last Name *</label>
              <input
                type="text"
                required
                placeholder="e.g. Adeleke"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Date of Birth</label>
              <input
                type="date"
                value={dob}
                onChange={handleDobChange}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Age (Years)</label>
              <input
                type="number"
                value={age}
                onChange={e => setAge(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Sex</label>
              <select
                value={sex}
                onChange={e => setSex(e.target.value as Patient['sex'])}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              >
                <option value="Female">Female</option>
                <option value="Male">Male</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>

          <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 border-b border-light-border dark:border-dark-border pb-1 pt-2">
            2. Contact & Emergency Next of Kin
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Phone Number *</label>
              <input
                type="tel"
                required
                placeholder="+234 800 000 0000"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Email Address</label>
              <input
                type="email"
                placeholder="patient@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Residential Address</label>
            <input
              type="text"
              placeholder="House, Street, Area, City"
              value={address}
              onChange={e => setAddress(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Next of Kin (Name & Relationship)</label>
              <input
                type="text"
                placeholder="e.g. Mary Adeleke (Spouse)"
                value={nextOfKin}
                onChange={e => setNextOfKin(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Emergency Contact Phone</label>
              <input
                type="tel"
                placeholder="+234 802 000 0000"
                value={emergencyContact}
                onChange={e => setEmergencyContact(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 border-b border-light-border dark:border-dark-border pb-1 pt-2">
            3. Clinical Baseline & Drug Allergies
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Blood Group</label>
              <select
                value={bloodGroup}
                onChange={e => setBloodGroup(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              >
                <option value="O Positive">O Positive (O+)</option>
                <option value="O Negative">O Negative (O-)</option>
                <option value="A Positive">A Positive (A+)</option>
                <option value="A Negative">A Negative (A-)</option>
                <option value="B Positive">B Positive (B+)</option>
                <option value="B Negative">B Negative (B-)</option>
                <option value="AB Positive">AB Positive (AB+)</option>
                <option value="AB Negative">AB Negative (AB-)</option>
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Genotype</label>
              <select
                value={genotype}
                onChange={e => setGenotype(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              >
                <option value="AA">AA</option>
                <option value="AS">AS (Carrier)</option>
                <option value="SS">SS (Sickle Cell)</option>
                <option value="AC">AC</option>
                <option value="SC">SC</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-bold text-rose-600 dark:text-rose-400 mb-1">
              Known Drug Allergies (comma separated)
            </label>
            <input
              type="text"
              placeholder="e.g. Penicillin, Sulpha drugs, Aspirin"
              value={allergiesText}
              onChange={e => setAllergiesText(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-rose-50/40 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-rose-500 focus:outline-none"
            />
          </div>

          <div className="flex justify-end space-x-3 pt-3 border-t border-light-border dark:border-dark-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-dark-surface text-slate-600 dark:text-slate-300 hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md"
            >
              Complete Registration
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
