import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../services/db';
import { X, User, Lock, KeyRound, CheckCircle2 } from 'lucide-react';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Self-service: staff can update their own details, device PIN and login password. */
export const AccountModal: React.FC<AccountModalProps> = ({ isOpen, onClose }) => {
  const { currentUser, setCurrentUser } = useAuth();
  const [tab, setTab] = useState<'details' | 'pin' | 'password'>('details');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(currentUser.name);
  const [email, setEmail] = useState(currentUser.email);
  const [department, setDepartment] = useState(currentUser.department);
  const [avatar, setAvatar] = useState(currentUser.avatar);
  const [newPin, setNewPin] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  React.useEffect(() => {
    if (isOpen) {
      setName(currentUser.name);
      setEmail(currentUser.email);
      setDepartment(currentUser.department);
      setAvatar(currentUser.avatar);
      setNotice(null);
      setError(null);
    }
  }, [isOpen, currentUser.id]);

  if (!isOpen) return null;

  const ok = (msg: string) => {
    setNotice(msg);
    setError(null);
    setTimeout(() => setNotice(null), 4000);
  };
  const fail = (msg: string) => {
    setError(msg);
    setNotice(null);
  };

  const handleSaveDetails = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      fail('Name and email are required.');
      return;
    }
    const updated = { ...currentUser, name: name.trim(), email: email.trim(), department: department.trim(), avatar };
    db.updateUser(updated, currentUser);
    setCurrentUser(updated);
    ok('Account details updated.');
  };

  const handleSavePin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(newPin)) {
      fail('PIN must be exactly 4 digits.');
      return;
    }
    const updated = { ...currentUser, pin: newPin };
    db.updateUser(updated, currentUser);
    setCurrentUser(updated);
    setNewPin('');
    ok('Device PIN updated.');
  };

  const handleSavePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      fail('New passwords do not match.');
      return;
    }
    try {
      db.changeOwnPassword(currentUser.id, currentPassword, newPassword);
      const updated = { ...db.getUserById(currentUser.id)! };
      setCurrentUser(updated);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      ok('Login password changed.');
    } catch (err: any) {
      fail(err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white dark:bg-dark-card border rounded-2xl shadow-2xl overflow-hidden select-text">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <User className="w-5 h-5 text-emerald-500" />
            <div>
              <h3 className="text-sm font-extrabold">My Account</h3>
              <p className="text-[11px] text-slate-500">{currentUser.name} • {currentUser.role.replace('_', ' ')}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex border-b text-xs font-bold">
          {(['details', 'pin', 'password'] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setError(null); setNotice(null); }}
              className={`flex-1 py-2.5 border-b-2 transition-all ${tab === t ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
            >
              {t === 'details' ? 'Details' : t === 'pin' ? 'Device PIN' : 'Password'}
            </button>
          ))}
        </div>

        <div className="p-5">
          {notice && (
            <div className="mb-3 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] font-bold text-emerald-700 flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4" /><span>{notice}</span>
            </div>
          )}
          {error && (
            <div className="mb-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] font-bold text-rose-700">
              {error}
            </div>
          )}

          {tab === 'details' && (
            <form onSubmit={handleSaveDetails} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold mb-1">Full Name & Title</label>
                <input value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-slate-50 border" />
              </div>
              <div>
                <label className="block font-bold mb-1">Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-slate-50 border" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Department</label>
                  <input value={department} onChange={e => setDepartment(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-slate-50 border" />
                </div>
                <div>
                  <label className="block font-bold mb-1">Avatar</label>
                  <select value={avatar} onChange={e => setAvatar(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-slate-50 border text-lg">
                    {['👨‍⚕️', '👩‍⚕️', '🧑‍⚕️', '👨‍🔬', '👩‍🔬', '🔬', '💊', '📋', '💳', '🩻', '🏃‍♀️', '👩‍💼', '💼', '🛡️'].map(a => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button type="submit" className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold">Save Details</button>
            </form>
          )}

          {tab === 'pin' && (
            <form onSubmit={handleSavePin} className="space-y-3 text-xs">
              <p className="text-slate-500">Your 4-digit device PIN wakes the workstation from sleep.</p>
              <div>
                <label className="block font-bold mb-1">New 4-Digit PIN</label>
                <input type="password" maxLength={4} value={newPin} onChange={e => setNewPin(e.target.value)} placeholder="••••" className="w-full px-3 py-2 rounded-xl bg-slate-50 border tracking-widest text-center font-mono" />
              </div>
              <button type="submit" className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center justify-center space-x-2">
                <KeyRound className="w-3.5 h-3.5" /><span>Update PIN</span>
              </button>
            </form>
          )}

          {tab === 'password' && (
            <form onSubmit={handleSavePassword} className="space-y-3 text-xs">
              {currentUser.mustChangePassword && (
                <p className="p-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 font-bold">Administration updated your password — please change it now.</p>
              )}
              <div>
                <label className="block font-bold mb-1">Current Password</label>
                <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-slate-50 border" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">New Password</label>
                  <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-slate-50 border" placeholder="Min 6 characters" />
                </div>
                <div>
                  <label className="block font-bold mb-1">Confirm New</label>
                  <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-slate-50 border" />
                </div>
              </div>
              <button type="submit" className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center justify-center space-x-2">
                <Lock className="w-3.5 h-3.5" /><span>Change Password</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
