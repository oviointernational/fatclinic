/**
 * Two screens for a forgotten password, both reached while signed out.
 *
 *  - `request`  : the "Forgotten your password?" form on the sign-in dialog. One
 *                field, an email address, and the clinic's rule applied to it.
 *  - `complete` : the screen a reset link lands on, asking for a new password.
 *
 * They share a file because they are one journey with two ends, and because the
 * awkward decision - that neither one may sign anybody in - is made once here
 * rather than twice. See `services/passwordReset.ts` for why that matters on a
 * shared clinic workstation.
 *
 * Both render at the top level of the app, above every clinical screen, so a
 * person following a reset link is never shown patient data while they work out
 * what the link did.
 */
import React, { useEffect, useState } from 'react';
import { X, Mail, KeyRound, Send, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { completeReset, describeResetTarget, requestResetEmail } from '../../services/passwordReset';
import { PASSWORD_RULES } from '../../services/passwordPolicy';

interface PasswordResetModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Set once a reset link has been followed, so the request form is not shown again. */
  hasResetLink: boolean;
}

type Screen = 'request' | 'complete';

export const PasswordResetModal: React.FC<PasswordResetModalProps> = ({
  isOpen,
  onClose,
  hasResetLink,
}) => {
  // The two screens are mutually exclusive and the choice is not the user's: a
  // reset link in the URL means they have already got one, so asking them for
  // their address again would be a step backwards.
  const [screen, setScreen] = useState<Screen>(hasResetLink ? 'complete' : 'request');

  // `request` screen state
  const [email, setEmail] = useState('');
  const [requesting, setRequesting] = useState(false);
  /**
   * The outcome sentence, verbatim from the function.
   *
   * Shown in a neutral panel rather than the red error box even when `sent` is
   * false. The request succeeded; the answer is only that this route is closed to
   * the address that was typed. Red here would say something is broken when
   * nothing is broken, and would be the same colour as a genuine outage.
   */
  const [requestOutcome, setRequestOutcome] = useState<{ sent: boolean; message: string } | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  // `complete` screen state
  const [targetEmail, setTargetEmail] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [completeDone, setCompleteDone] = useState(false);

  useEffect(() => {
    setScreen(hasResetLink ? 'complete' : 'request');
  }, [hasResetLink]);

  // Asked once, on the `complete` screen, so the form can say whose password is
  // being changed. Resolved from the token rather than the URL, and a failure
  // here is not worth a message - the change is still allowed to proceed.
  useEffect(() => {
    if (!isOpen || screen !== 'complete') return;
    let live = true;
    void describeResetTarget().then((found) => {
      if (live) setTargetEmail(found);
    });
    return () => {
      live = false;
    };
  }, [isOpen, screen]);

  if (!isOpen) return null;

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (requesting) return;

    const address = email.trim();
    if (!address) {
      setRequestError('Enter your staff email address.');
      return;
    }

    setRequesting(true);
    setRequestError(null);
    setRequestOutcome(null);
    try {
      const outcome = await requestResetEmail(address);
      if (outcome.ok) {
        setRequestOutcome({ sent: outcome.sent, message: outcome.message });
        // The address is cleared on both outcomes. On a refusal the sentence
        // tells them who to ask; leaving the box filled invites a second attempt
        // with the same address, which can only produce the same answer.
        setEmail('');
      } else {
        setRequestError(outcome.message);
      }
    } catch (err) {
      console.error('[password-reset] request threw unexpectedly:', err);
      setRequestError('The reset link could not be requested. Try again.');
    } finally {
      setRequesting(false);
    }
  };

  const handleComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (completing) return;

    if (password !== confirm) {
      setCompleteError('The two passwords do not match.');
      return;
    }

    setCompleting(true);
    setCompleteError(null);
    try {
      const outcome = await completeReset(password);
      if (outcome.ok) {
        setCompleteDone(true);
        setPassword('');
        setConfirm('');
      } else {
        setCompleteError(outcome.message);
        setPassword('');
      }
    } catch (err) {
      console.error('[password-reset] completion threw unexpectedly:', err);
      setCompleteError('The password could not be changed. Try again.');
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white dark:bg-dark-card border border-light-border dark:border-dark-border rounded-2xl shadow-2xl overflow-hidden select-text animate-in fade-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-light-border dark:border-dark-border flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <KeyRound className="w-5 h-5 text-amber-500" />
            <h3 className="text-base font-extrabold text-slate-800 dark:text-white">
              {screen === 'complete' ? 'Set a new password' : 'Forgotten your password?'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:bg-dark-surface"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {screen === 'request' ? (
          <div className="p-6">
            {/* No notice about who this route is for. The rule is not explained
                before the field: the outcome carries it instead, so the only
                person who reads "administrators only" is one whose address turns
                out not to qualify - which is the person who needed to know. */}
            {requestOutcome ? (
              <div className="space-y-4">
                <div
                  className={`p-3 rounded-xl border text-[11px] font-bold leading-relaxed ${
                    requestOutcome.sent
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-slate-50 border-light-border text-slate-700 dark:bg-dark-surface dark:border-dark-border dark:text-slate-200'
                  }`}
                >
                  {requestOutcome.message}
                </div>
                <button
                  onClick={onClose}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition-all"
                >
                  Back to sign in
                </button>
              </div>
            ) : (
              <form onSubmit={handleRequest} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    <span className="inline-flex items-center space-x-1">
                      <Mail className="w-3 h-3" />
                      <span>Staff Email:</span>
                    </span>
                  </label>
                  <input
                    type="email"
                    required
                    autoComplete="username"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setRequestError(null);
                    }}
                    placeholder="you@fatclinic.health"
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>

                {requestError && (
                  <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] font-bold text-rose-700">
                    {requestError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={requesting}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-xs shadow-md transition-all flex items-center justify-center space-x-2"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{requesting ? 'Sending…' : 'Send reset link'}</span>
                </button>
              </form>
            )}
          </div>
        ) : (
          <div className="p-6">
            {completeDone ? (
              <div className="space-y-4 text-center">
                <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                </div>
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200 leading-relaxed">
                  Your password has been changed. Sign in with it below.
                </p>
                <button
                  onClick={onClose}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition-all"
                >
                  Go to sign in
                </button>
              </div>
            ) : (
              <form onSubmit={handleComplete} className="space-y-4">
                {/* Naming the account is worth the round trip: following a link is
                    a one-click action, and on a shared machine or a forwarded
                    email the person may not be who the link was sent to. */}
                {targetEmail ? (
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-[11px] font-bold text-slate-600 dark:text-slate-300 break-all">
                    Setting a new password for <span className="text-emerald-600 dark:text-emerald-400">{targetEmail}</span>
                  </div>
                ) : null}

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    <span className="inline-flex items-center space-x-1">
                      <KeyRound className="w-3 h-3" />
                      <span>New Password:</span>
                    </span>
                  </label>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setCompleteError(null);
                    }}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    <span className="inline-flex items-center space-x-1">
                      <ShieldCheck className="w-3 h-3" />
                      <span>Confirm New Password:</span>
                    </span>
                  </label>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => {
                      setConfirm(e.target.value);
                      setCompleteError(null);
                    }}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>

                <ul className="text-[10px] text-slate-500 dark:text-slate-400 space-y-0.5 list-disc pl-4">
                  {PASSWORD_RULES.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>

                {completeError && (
                  <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] font-bold text-rose-700">
                    {completeError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={completing}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-xs shadow-md transition-all"
                >
                  {completing ? 'Changing…' : 'Set new password'}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
