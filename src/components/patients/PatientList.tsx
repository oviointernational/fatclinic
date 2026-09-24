import React, { useState } from 'react';
import { Patient } from '../../types';
import { db } from '../../services/db';
import { useSyncDb } from '../../hooks/useSyncDb';
import {
  Search,
  UserPlus,
  Calendar,
  Phone,
  User
} from 'lucide-react';

interface PatientListProps {
  onSelectProfile: (patient: Patient) => void;
  onSelectVisitTabs: (patient: Patient) => void;
  onOpenAuditLog: (patientId: string, patientName: string) => void;
  onOpenRegistration: () => void;
}

export const PatientList: React.FC<PatientListProps> = ({
  onSelectProfile,
  onSelectVisitTabs,
  onOpenRegistration,
}) => {
  useSyncDb();
  const [search, setSearch] = useState('');
  const [sexFilter, setSexFilter] = useState<'ALL' | 'Male' | 'Female'>('ALL');

  const patients = db.getPatients();

  const filteredPatients = patients.filter(p => {
    const matchesSearch = 
      p.id.toLowerCase().includes(search.toLowerCase()) ||
      `${p.firstName} ${p.middleName || ''} ${p.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
      p.phone.includes(search);
    const matchesSex = sexFilter === 'ALL' || p.sex === sexFilter;
    return matchesSearch && matchesSex;
  });

  return (
    <div className="h-full flex flex-col select-text overflow-hidden p-4 md:p-6 space-y-4">
      {/* Compact control bar: search + filter + count + register */}
      <div className="rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex flex-wrap items-center gap-2 p-3 flex-shrink-0">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search by Patient ID, Name, or Phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div className="flex items-center space-x-1.5">
          {(['ALL', 'Male', 'Female'] as const).map(sex => (
            <button
              key={sex}
              onClick={() => setSexFilter(sex)}
              className={`px-2.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
                sexFilter === sex
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-dark-surface text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              {sex}
            </button>
          ))}
        </div>

        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 px-2">
          {filteredPatients.length} patient{filteredPatients.length === 1 ? '' : 's'}
        </span>

        <button
          onClick={onOpenRegistration}
          className="flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md transition-all"
        >
          <UserPlus className="w-4 h-4" />
          <span>Register New Patient</span>
        </button>
      </div>

      {/* Patients Table Card */}
      <div className="flex-1 min-h-0 overflow-hidden rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex flex-col">
        <div className="overflow-auto flex-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 dark:bg-dark-surface/60 border-b border-light-border dark:border-dark-border text-slate-500 uppercase text-[10px] font-extrabold sticky top-0 z-10">
              <tr>
                <th className="py-3 px-4">Patient ID</th>
                <th className="py-3 px-4">Full Name</th>
                <th className="py-3 px-4">Demographics</th>
                <th className="py-3 px-4">Phone & Contact</th>
                <th className="py-3 px-4">Allergies / Alerts</th>
                <th className="py-3 px-4 text-center">Actions & Log</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-light-border/60 dark:divide-dark-border/60">
              {filteredPatients.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-400">
                    No patients found matching your search.
                  </td>
                </tr>
              ) : (
                filteredPatients.map(patient => {
                  return (
                    <tr
                      key={patient.id}
                      onClick={() => onSelectVisitTabs(patient)}
                      title="Click to open Patient Timeline"
                      className="hover:bg-emerald-50/60 dark:hover:bg-emerald-950/20 transition-colors cursor-pointer"
                    >
                      {/* Patient ID */}
                      <td className="py-3.5 px-4 font-mono font-bold text-emerald-700 dark:text-emerald-400">
                        {patient.id}
                      </td>

                      {/* Name */}
                      <td className="py-3.5 px-4">
                        <div className="font-extrabold text-slate-900 dark:text-white">
                          {patient.firstName} {patient.middleName || ''} {patient.lastName}
                        </div>
                        <span className="text-[10px] text-slate-400">
                          Registered: {new Date(patient.registeredAt).toLocaleDateString()}
                        </span>
                      </td>

                      {/* Demographics */}
                      <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">
                        <div>{patient.sex}, {patient.age} yrs</div>
                        <div className="text-[10px] text-slate-400">
                          {patient.genotype || 'AA'} • {patient.bloodGroup || 'O+'}
                        </div>
                      </td>

                      {/* Phone */}
                      <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">
                        <div className="flex items-center space-x-1">
                          <Phone className="w-3 h-3 text-slate-400" />
                          <span>{patient.phone}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 truncate max-w-[180px]">
                          {patient.address}
                        </div>
                      </td>

                      {/* Allergies / Alerts */}
                      <td className="py-3.5 px-4">
                        {patient.allergies.length > 0 ? (
                          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900">
                            {patient.allergies[0]} {patient.allergies.length > 1 ? `+${patient.allergies.length - 1}` : ''}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400">None</span>
                        )}
                      </td>

                      {/* Actions: Profile + Visits — row click also opens Timeline */}
                      <td className="py-3.5 px-4 text-center">
                        <div className="flex items-center justify-center space-x-1.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); onSelectProfile(patient); }}
                            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 border border-emerald-200 dark:border-emerald-800 transition-all"
                            title="Open Patient Profile"
                          >
                            <User className="w-3 h-3" />
                            <span>Profile</span>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); onSelectVisitTabs(patient); }}
                            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 border border-blue-200 dark:border-blue-800 transition-all"
                            title="Open Patient Timeline / Visits"
                          >
                            <Calendar className="w-3 h-3" />
                            <span>Visits</span>
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
    </div>
  );
};
