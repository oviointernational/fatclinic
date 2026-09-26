import React, { useState } from 'react';
import { BedDouble, X } from 'lucide-react';
import { WARD_OPTIONS } from '../../types';

interface AdmitDialogProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onConfirm: (ward: string) => void;
}

/** Admission requires a ward to be specified. */
export const AdmitDialog: React.FC<AdmitDialogProps> = ({ title, subtitle, onClose, onConfirm }) => {
  const [ward, setWard] = useState(WARD_OPTIONS[0].code);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ward) {
      setError('Select a ward to admit this patient.');
      return;
    }
    onConfirm(ward);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60" onClick={onClose} />
      <form onSubmit={handleSubmit} className="relative bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-sm border p-5 space-y-4 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <BedDouble className="w-5 h-5 text-amber-600" />
            <div>
              <h3 className="font-extrabold text-sm">{title}</h3>
              {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>

        <div>
          <label className="block font-bold mb-1">Admit to Ward (required):</label>
          <select
            value={ward}
            onChange={e => { setWard(e.target.value); setError(null); }}
            className="w-full px-3 py-2 rounded-xl bg-slate-50 border font-bold"
          >
            {WARD_OPTIONS.map(w => (
              <option key={w.code} value={w.code}>{w.name}</option>
            ))}
          </select>
        </div>

        {error && (
          <div className="p-2 rounded-xl bg-rose-50 border border-rose-200 text-[11px] font-bold text-rose-700">{error}</div>
        )}

        <div className="flex justify-end space-x-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border font-bold">Cancel</button>
          <button type="submit" className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold">Confirm Admission</button>
        </div>
      </form>
    </div>
  );
};
