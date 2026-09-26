import React, { useState } from 'react';
import { useAuth, useCurrentUser } from '../../context/AuthContext';
import { Lock, ShieldCheck, Delete, ArrowRight } from 'lucide-react';

export const PinLockModal: React.FC = () => {
  const { isSleeping, wakeUpWithPin } = useAuth();
  const currentUser = useCurrentUser();
  const [pin, setPin] = useState<string>('');
  const [error, setError] = useState<string>('');

  const submitPin = (nextPin: string) => {
    pinRef.current = nextPin;
    setPin(nextPin);
    setError('');
    if (nextPin.length === 4) {
      setTimeout(() => {
        const success = wakeUpWithPin(nextPin);
        if (!success) {
          setError('Incorrect PIN — enter your own account PIN.');
          pinRef.current = '';
          setPin('');
        }
      }, 120);
    }
  };

  // Mirror of the PIN for the global key listener (avoids stale closures).
  const pinRef = React.useRef('');
  React.useEffect(() => {
    pinRef.current = pin;
  }, [pin]);

  // Physical keyboard support: number keys 0-9 type the PIN, Backspace deletes.
  // (Hook sits before the early return so hook order never changes.)
  React.useEffect(() => {
    if (!isSleeping) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        if (pinRef.current.length < 4) submitPin(pinRef.current + e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        pinRef.current = pinRef.current.slice(0, -1);
        setPin(pinRef.current);
        setError('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isSleeping]);

  if (!isSleeping) return null;

  const handleDigit = (digit: string) => {
    if (pin.length < 4) {
      submitPin(pin + digit);
    }
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
    setError('');
  };

  const handleClear = () => {
    setPin('');
    setError('');
  };

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-slate-950/80 backdrop-blur-md transition-opacity">
      <div className="w-full max-w-sm p-6 rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-2xl text-center select-text animate-in fade-in zoom-in-95 duration-200">
        
        {/* Device Lock Header */}
        <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
          <Lock className="w-7 h-7 animate-pulse" />
        </div>

        <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
          Workstation Sleep Mode
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Device secured for <span className="font-semibold text-emerald-600 dark:text-emerald-400">{currentUser.name}</span> ({currentUser.role.replace('_', ' ')})
        </p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
          Tap the keypad or type your 4-digit account PIN on the keyboard
        </p>

        {/* 4-Digit Bubble Indicator */}
        <div className="flex justify-center items-center space-x-4 my-6">
          {[0, 1, 2, 3].map(idx => (
            <div
              key={idx}
              className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${
                idx < pin.length
                  ? 'bg-emerald-500 border-emerald-500 scale-110 shadow-sm'
                  : 'border-slate-300 dark:border-slate-600 bg-transparent'
              }`}
            />
          ))}
        </div>

        {error && (
          <div className="text-xs text-rose-500 font-semibold mb-3">
            {error}
          </div>
        )}

        {/* Numeric Keypad */}
        <div className="grid grid-cols-3 gap-3 max-w-[240px] mx-auto mb-4">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
            <button
              key={num}
              onClick={() => handleDigit(num)}
              className="w-14 h-14 mx-auto rounded-2xl bg-slate-100 dark:bg-dark-surface hover:bg-emerald-100 dark:hover:bg-emerald-950/40 text-slate-800 dark:text-slate-100 text-lg font-bold transition-all active:scale-95 flex items-center justify-center shadow-sm"
            >
              {num}
            </button>
          ))}
          <button
            onClick={handleClear}
            className="w-14 h-14 mx-auto rounded-2xl bg-slate-100 dark:bg-dark-surface hover:bg-rose-100 dark:hover:bg-rose-950/40 text-slate-500 text-xs font-bold transition-all active:scale-95 flex items-center justify-center"
          >
            Clear
          </button>
          <button
            onClick={() => handleDigit('0')}
            className="w-14 h-14 mx-auto rounded-2xl bg-slate-100 dark:bg-dark-surface hover:bg-emerald-100 dark:hover:bg-emerald-950/40 text-slate-800 dark:text-slate-100 text-lg font-bold transition-all active:scale-95 flex items-center justify-center shadow-sm"
          >
            0
          </button>
          <button
            onClick={handleBackspace}
            className="w-14 h-14 mx-auto rounded-2xl bg-slate-100 dark:bg-dark-surface hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-base font-bold transition-all active:scale-95 flex items-center justify-center"
          >
            <Delete className="w-5 h-5" />
          </button>
        </div>

        <div className="text-[11px] text-slate-400 dark:text-slate-500 flex items-center justify-center space-x-1">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span>Locked to this account — other users cannot unlock it</span>
        </div>
      </div>
    </div>
  );
};
