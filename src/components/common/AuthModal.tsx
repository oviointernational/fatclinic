import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { X, LogIn, ShieldCheck, Lock, Mail } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  // Credentials go to Supabase Auth and are never compared here, never stored
  // here, and never sent anywhere but the auth endpoint. The failure message
  // comes back from services/auth.ts, which collapses "no such address" and
  // "wrong password" into one reply on purpose: distinguishing them would turn
  // this form into a way to enumerate staff accounts.
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);

    const address = email.trim();
    if (!address) {
      setError('Enter your staff email address.');
      return;
    }

    setIsSubmitting(true);
    try {
      const outcome = await signIn(address, password);
      if (outcome.ok) {
        setEmail('');
        setPassword('');
        onClose();
        return;
      }
      setError(outcome.message);
      // Never leave a typed password sitting in a field after a failure.
      setPassword('');
    } catch (err) {
      console.error('[auth] sign-in failed unexpectedly:', err);
      setError('Sign-in could not be completed. Try again, or contact Administration.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white dark:bg-dark-card border border-light-border dark:border-dark-border rounded-2xl shadow-2xl overflow-hidden select-text animate-in fade-in zoom-in-95 duration-200">

        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-light-border dark:border-dark-border flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
            <h3 className="text-base font-extrabold text-slate-800 dark:text-white">
              FatClinic Workstation Access
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-surface"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6">
          <form onSubmit={handleSignIn} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                <span className="inline-flex items-center space-x-1"><Mail className="w-3 h-3" /><span>Staff Email:</span></span>
              </label>
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(null); }}
                placeholder="you@fatclinic.health"
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                <span className="inline-flex items-center space-x-1"><Lock className="w-3 h-3" /><span>Login Password:</span></span>
              </label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(null); }}
                placeholder="Password given to you by Administration"
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>

            {error && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] font-bold text-rose-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-xs shadow-md transition-all mt-4 flex items-center justify-center space-x-2"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Signing in…' : 'Sign In to Workstation'}</span>
            </button>

            <p className="text-[10px] text-slate-400 text-center leading-relaxed">
              Accounts are entirely database-controlled — staff cannot self-register.<br />
              Your password is checked by the clinic server, never stored in this browser.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
};
