import React, { useState } from 'react';
import { useAuth, useCurrentUser } from '../../context/AuthContext';
import { db } from '../../services/db';
import { changePassword, clearOwnMustChangePassword, updateOwnProfile } from '../../services/auth';
import { X, User, Lock, KeyRound, CheckCircle2 } from 'lucide-react';
// Aliased: `User` above is the lucide icon, not the staff profile.
import type { User as StaffProfile } from '../../types';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Lock the screen to the password form and refuse to close.
   *
   * Set when an administrator has issued a password, so the credential they read
   * out over a ward telephone cannot become the person's standing one. The app
   * is not rendered behind this, so the only way past it is a real change.
   */
  forced?: boolean;
  /** Called after a forced change succeeds, so the caller can release the gate. */
  onPasswordChanged?: () => void;
  /** Always offered in forced mode: someone who cannot get in must still be able to leave. */
  onSignOut?: () => void;
}

/**
 * Self-service account screen: profile details, the workstation screen-lock PIN,
 * and the sign-in password.
 *
 * The password is changed through `supabase.auth`, not by writing a field on the
 * user row, because that row has no password column and never will. That is the
 * whole point of the split: the profile is clinic data and syncs through the
 * normal diff; the credential is not clinic data, is never written to
 * localStorage, and is never included in a sync payload.
 */
export const AccountModal: React.FC<AccountModalProps> = ({ isOpen, onClose, forced = false, onPasswordChanged, onSignOut }) => {
  const { setCurrentUser } = useAuth();
  const currentUser = useCurrentUser();
  const [tab, setTab] = useState<'details' | 'pin' | 'password'>('details');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(currentUser.name);
  const [email, setEmail] = useState(currentUser.email);
  const [department, setDepartment] = useState(currentUser.department);
  const [avatar, setAvatar] = useState(currentUser.avatar);
  const [newPin, setNewPin] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [reauthCode, setReauthCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [isChanging, setIsChanging] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setName(currentUser.name);
      setEmail(currentUser.email);
      setDepartment(currentUser.department);
      setAvatar(currentUser.avatar);
      setNotice(null);
      setError(null);
      setNeedsCode(false);
      // A forced change opens on the password form rather than wherever the
      // clinician last was, so the only thing on screen is the thing to do.
      if (forced) setTab('password');
    }
  }, [isOpen, currentUser.id, forced]);

  if (!isOpen) return null;

  // In forced mode this is not a dialog, it is the whole screen: closing it
  // would put an application full of patient records behind a credential the
  // administrator chose. So there is nothing to close.
  const dismissible = !forced;

  const ok = (msg: string) => {
    setNotice(msg);
    setError(null);
    setTimeout(() => setNotice(null), 4000);
  };
  const fail = (msg: string) => {
    setError(msg);
    setNotice(null);
  };

  const handleSaveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      fail('Name and email are required.');
      return;
    }
    // public.users is an admin table; a clinician writing their own row matches
    // no RLS policy, so this goes through the app_update_own_profile function,
    // which updates the server and resolves the row from the JWT. Only the
    // server's answer settles the UI - a local-only save would report success
    // for a change the database refused.
    setIsChanging(true);
    try {
      const result = await updateOwnProfile({
        name: name.trim(),
        department: department.trim(),
        avatar,
      });
      if (!result.ok) {
        fail(result.message);
        return;
      }
      const updated = { ...currentUser, name: name.trim(), email: email.trim(), department: department.trim(), avatar };
      db.updateOwnUser(updated);
      setCurrentUser(updated);
      ok('Account details updated.');
    } finally {
      setIsChanging(false);
    }
  };

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(newPin)) {
      fail('PIN must be exactly 4 digits.');
      return;
    }
    setIsChanging(true);
    try {
      const result = await updateOwnProfile({ pin: newPin });
      if (!result.ok) {
        fail(result.message);
        return;
      }
      const updated = { ...currentUser, pin: newPin };
      db.updateOwnUser(updated);
      setCurrentUser(updated);
      setNewPin('');
      ok('Device PIN updated.');
    } finally {
      setIsChanging(false);
    }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isChanging) return;
    if (newPassword !== confirmPassword) {
      fail('New passwords do not match.');
      return;
    }
    if (needsCode && !reauthCode.trim()) {
      fail('Enter the code from the email.');
      return;
    }

    setIsChanging(true);
    try {
      const result = await changePassword(newPassword, needsCode ? reauthCode.trim() : undefined);
      if (result.ok) {
        setNewPassword('');
        setConfirmPassword('');
        setReauthCode('');
        setNeedsCode(false);
        // Clear the "must change" flag in the same breath. Supabase has already
        // stored the new credential; this only updates the profile, and leaving
        // it set would lock the person straight back into this form on their
        // next sign-in even though they had just chosen a password of their own.
        //
        // The flag is cleared by the function in the database, not by
        // `db.updateUser`, because `public.users` is an admin table: a clinician
        // writing their own row matches no RLS policy, so the change is dropped
        // and this screen never opens. The server's answer is what decides
        // whether the gate releases, not the local copy.
        if (currentUser.mustChangePassword) {
          const cleared = await clearOwnMustChangePassword();
          const updated: StaffProfile = { ...currentUser, mustChangePassword: !cleared };
          db.applyServerConfirmedUser(updated);
          setCurrentUser(updated);
          if (!cleared) {
            // The password really did change, but the flag did not, so this
            // screen is about to stay exactly where it is. Saying so is the
            // only honest thing: the alternative is a person retrying until
            // they are refused for reusing the password they just set.
            fail(
              'Your password was changed, but the workstation could not mark it as done. ' +
              'Sign out and sign in again; if this screen returns, tell your administrator.',
            );
            return;
          }
        }
        if (forced) {
          onPasswordChanged?.();
          return;
        }
        ok('Sign-in password changed.');
        return;
      }
      setNeedsCode(result.kind === 'needs-nonce');
      fail(result.message);
    } catch (err) {
      console.error('[auth] password change failed unexpectedly:', err);
      fail('The password could not be changed. Contact Administration.');
    } finally {
      setIsChanging(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white dark:bg-dark-card border rounded-2xl shadow-2xl overflow-hidden select-text">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <User className="w-5 h-5 text-emerald-500" />
            <div>
              <h3 className="text-sm font-extrabold">{forced ? 'Choose your password' : 'My Account'}</h3>
              <p className="text-[11px] text-slate-500">{currentUser.name} • {currentUser.role.replace('_', ' ')}</p>
            </div>
          </div>
          {dismissible && (
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button>
          )}
        </div>

        {forced && (
          <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 text-[11px] leading-relaxed text-amber-800">
            <p className="font-extrabold">An administrator has issued you a password.</p>
            <p className="mt-1">
              Choose your own before you continue. Patient records stay hidden until you do.
            </p>
          </div>
        )}

        {!forced && (
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
        )}

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
                <input
                  type="email"
                  value={email}
                  disabled
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border opacity-70 cursor-not-allowed"
                />
                <p className="mt-1 text-slate-400">This is how you sign in. Email changes are made by Administration.</p>
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
              {currentUser.mustChangePassword && !forced && (
                <p className="p-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 font-bold">Administration reset your password — please choose a new one now.</p>
              )}
              <p className="text-slate-500 leading-relaxed">
                This is your sign-in password for the workstation. Choose one you do not use
                anywhere else, and do not write it on the ward terminal.
              </p>
              {needsCode && (
                <div>
                  <label className="block font-bold mb-1">Code from the email</label>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={reauthCode}
                    onChange={e => setReauthCode(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border font-mono tracking-widest"
                    placeholder="000000"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">New Password</label>
                  <input type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-slate-50 border" placeholder="Min 8 characters" />
                </div>
                <div>
                  <label className="block font-bold mb-1">Confirm New</label>
                  <input type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-slate-50 border" />
                </div>
              </div>
              <button
                type="submit"
                disabled={isChanging}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold flex items-center justify-center space-x-2"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>{isChanging ? 'Changing…' : forced ? 'Set my password' : 'Change Password'}</span>
              </button>
              {forced && onSignOut && (
                // The escape hatch, and it is not optional. Without it a clinician
                // who cannot get in - wrong address, no note of the password, a
                // terminal they do not own - would be stranded on a screen with
                // no way out, holding a session they cannot use. Being unable to
                // leave is a worse failure than being unable to enter.
                <button
                  type="button"
                  onClick={onSignOut}
                  className="w-full py-2.5 rounded-xl border border-slate-300 dark:border-dark-border text-slate-600 dark:text-slate-300 font-bold hover:bg-slate-50 dark:hover:bg-dark-surface"
                >
                  Sign out instead
                </button>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
