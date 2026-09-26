import React, { useState } from 'react';
import { useAuth, useCurrentUser } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { 
  Sun, 
  Moon, 
  Search, 
  Lock, 
  UserCheck, 
  Activity, 
  LogIn, 
  Sparkles,
  ShieldAlert,
  CalendarPlus
} from 'lucide-react';
import { db } from '../../services/db';
import { getSupabase, isSupabaseConfigured } from '../../services/supabase';
import { pendingKeys } from '../../services/sync';
import { Patient, UserRole } from '../../types';
import { OnlineBookingModal } from '../frontdesk/OnlineBookingModal';
import { AccountModal } from '../common/AccountModal';

/**
 * Is this browser's data actually reaching Postgres?
 *
 * The previous version of this dot asked `fetch('/api/health')` and trusted
 * `res.ok`. That was worse than having no indicator at all, because it was
 * confidently wrong: `wrangler.jsonc` sets `not_found_handling:
 * "single-page-application"`, so Cloudflare Pages answers *any* unmatched path -
 * including `/api/health` - with `index.html` and HTTP 200. The dot rendered
 * green, permanently, while every write was being rejected. A clinician had no
 * way to tell that a patient's records existed in exactly one browser.
 *
 * So the check now goes where the data goes. A one-row read against `wards`
 * proves three things at once, and all three have to hold: DNS resolves, the
 * project answers, and the signed-in session satisfies RLS. `wards` is chosen
 * because it is tiny, seeded, and behind RLS like everything else.
 *
 * The second half of the indicator is the one that matters most. "Connected" only
 * says a read worked; what a clinician needs to know is whether *their* last
 * entries are saved, so unsaved collections are surfaced separately and take
 * priority over the connection colour.
 */
type SyncState = 'local-only' | 'checking' | 'connected' | 'offline';

const ServerStatus: React.FC = () => {
  const [state, setState] = useState<SyncState>(isSupabaseConfigured ? 'checking' : 'local-only');
  const [unsaved, setUnsaved] = useState<number>(0);

  // Network reachability: cheap, but not free, so once a minute.
  React.useEffect(() => {
    if (!isSupabaseConfigured) return;
    const client = getSupabase();
    if (!client) return;

    let cancelled = false;
    const ping = async () => {
      try {
        const { error } = await client.from('wards').select('code').limit(1);
        if (!cancelled) setState(error ? 'offline' : 'connected');
      } catch {
        // A thrown fetch means DNS or the network failed, not that the row is
        // absent. Either way it is not connected.
        if (!cancelled) setState('offline');
      }
    };
    void ping();
    const timer = setInterval(ping, 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Outstanding writes: an in-memory read, so it can be polled often enough for
  // the badge to appear while a clinician is still looking at the screen.
  React.useEffect(() => {
    const refresh = () => setUnsaved(pendingKeys().length);
    refresh();
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, []);

  const title = unsaved
    ? `${unsaved} change${unsaved === 1 ? '' : 's'} not yet saved to the server. They are safe in this browser and will be retried.`
    : state === 'connected'
    ? 'Connected: entries are being saved to the clinic database.'
    : state === 'offline'
    ? 'The clinic database is unreachable. Entries are being kept in this browser only and have NOT reached the server.'
    : state === 'local-only'
    ? 'This build has no database connection configured. Entries are kept in this browser only and are not backed up anywhere.'
    : 'Checking the clinic database…';

  // Unsaved work outranks connection state: a green light next to a pending
  // write would be the exact false all-clear this component exists to remove.
  const tone =
    unsaved || state === 'offline' || state === 'local-only'
      ? state === 'offline' || state === 'local-only'
        ? 'bad'
        : 'warn'
      : state === 'connected'
      ? 'good'
      : 'wait';

  const label =
    unsaved > 0
      ? `${unsaved} unsaved`
      : tone === 'bad'
      ? 'Not saving'
      : state === 'connected'
      ? 'Server DB'
      : '…';

  const tones: Record<string, string> = {
    good:
      'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
    warn: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
    bad: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
    wait: 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-dark-surface dark:text-slate-400 dark:border-dark-border',
  };
  const dots: Record<string, string> = {
    good: 'bg-emerald-500',
    warn: 'bg-amber-500 animate-pulse',
    bad: 'bg-rose-500 animate-pulse',
    wait: 'bg-slate-400',
  };

  return (
    <span
      title={title}
      className={`hidden sm:inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
        tones[tone]
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dots[tone]}`} />
      <span>{label}</span>
    </span>
  );
};

interface HeaderProps {
  onSelectPatient?: (patient: Patient) => void;
  onOpenSignInModal: () => void;
  onOpenAuditLogs: () => void;
  onNavigateHome: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onSelectPatient,
  onOpenSignInModal,
  onOpenAuditLogs,
  onNavigateHome
}) => {
  const { isAuthenticated, putToSleep, signOut } = useAuth();
  const currentUser = useCurrentUser();
  const { theme, toggleTheme } = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Patient[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (val.trim().length > 0) {
      const res = db.searchPatients(val);
      setSearchResults(res.slice(0, 5));
      setShowSearchResults(true);
    } else {
      setSearchResults([]);
      setShowSearchResults(false);
    }
  };

  const handleSelectPatient = (p: Patient) => {
    setSearchQuery('');
    setShowSearchResults(false);
    if (onSelectPatient) {
      onSelectPatient(p);
    }
  };

  return (
    <header className="w-full h-16 px-6 flex items-center justify-between select-text bg-light-bg dark:bg-dark-bg text-light-text dark:text-dark-text transition-colors duration-200">
      {/* Upper Left: Finely Crafted Name */}
      <div className="flex items-center space-x-3 cursor-pointer group" onClick={onNavigateHome}>
        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-emerald-600 via-teal-500 to-emerald-400 flex items-center justify-center text-white shadow-md group-hover:scale-105 transition-transform">
          <Activity className="w-5 h-5 text-white animate-pulse" />
        </div>
        <div className="flex flex-col">
          <div className="flex items-center space-x-1.5">
            <span className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white font-sans">
              Fat<span className="text-emerald-500">Clinic</span>
            </span>
            <span className="px-2 py-0.5 text-[10px] font-bold tracking-widest uppercase rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
              EHR
            </span>
          </div>
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 -mt-1 hidden sm:inline">
            Precision Clinical & Hospital Information System
          </span>
        </div>
      </div>

      {/* Center: Global Fast Patient Search */}
      {isAuthenticated && (
        <div className="relative w-72 md:w-96">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 absolute left-3 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Quick search patient (ID, Name, Phone)..."
              value={searchQuery}
              onChange={handleSearchChange}
              onFocus={() => searchQuery && setShowSearchResults(true)}
              className="w-full pl-9 pr-4 py-1.5 text-xs rounded-full bg-white dark:bg-dark-card border border-light-border dark:border-dark-border text-light-text dark:text-dark-text placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm transition-all"
            />
          </div>

          {/* Search Dropdown */}
          {showSearchResults && searchResults.length > 0 && (
            <div className="absolute top-10 left-0 right-0 z-50 bg-white dark:bg-dark-card border border-light-border dark:border-dark-border rounded-xl shadow-xl overflow-hidden py-1">
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-light-border dark:border-dark-border">
                Matching Patients ({searchResults.length})
              </div>
              {searchResults.map(patient => (
                <div
                  key={patient.id}
                  onClick={() => handleSelectPatient(patient)}
                  className="px-3 py-2 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 cursor-pointer flex items-center justify-between transition-colors"
                >
                  <div>
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                      {patient.firstName} {patient.lastName}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {patient.id} • {patient.sex}, {patient.age}y • {patient.phone}
                    </div>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    Open Profile
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Upper Right: Actions, Role Switcher, Sleep Avatar & Auth */}
      <div className="flex items-center space-x-3">
        <ServerStatus />
        {/* Book Appointment / Self-Register Modal Button */}
        <button
          onClick={() => setIsBookingModalOpen(true)}
          title="Patient Online Booking & Pre-Registration"
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm transition-all"
        >
          <CalendarPlus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Book Appointment</span>
        </button>

        {/* Audit Log Quick Trigger */}
        {isAuthenticated && (
          <button
            onClick={onOpenAuditLogs}
            title="View Immutable Audit Log"
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-dark-surface transition-colors"
          >
            <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
            <span className="hidden md:inline">Audit Log</span>
          </button>
        )}

        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          title={theme === 'light' ? 'Switch to Dark Mode (Off-Black-Blueish)' : 'Switch to Light Mode (Off-White)'}
          className="p-2 rounded-full hover:bg-slate-200/60 dark:hover:bg-dark-surface transition-colors text-slate-600 dark:text-slate-300"
        >
          {theme === 'light' ? (
            <Moon className="w-4 h-4 text-slate-700" />
          ) : (
            <Sun className="w-4 h-4 text-amber-400" />
          )}
        </button>

        {isAuthenticated ? (
          <div className="flex items-center space-x-3">
            {/* Signed-in role badge (no switching — each user stays in their own account) */}
            <div
              className="flex items-center space-x-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-dark-surface border border-light-border dark:border-dark-border text-xs font-semibold shadow-sm"
              title={`Signed in as ${currentUser.name} — account switching is disabled`}
            >
              <UserCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span className="truncate max-w-[120px]">{currentUser.role.replace('_', ' ')}</span>
            </div>

            {/* Circular Avatar menu: My Account + Sleep Lock */}
            <div className="relative">
              <button
                onClick={() => setShowAvatarMenu(v => !v)}
                title="Account menu"
                className="relative w-10 h-10 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-600 flex items-center justify-center text-lg text-white shadow-md hover:scale-105 transition-transform cursor-pointer border-2 border-white dark:border-dark-border"
              >
                <span>{currentUser.avatar || '👨‍⚕️'}</span>
                <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-emerald-600 dark:bg-emerald-500 rounded-full flex items-center justify-center text-[9px] text-white border border-white dark:border-dark-bg">
                  <Lock className="w-2.5 h-2.5" />
                </div>
              </button>
              {showAvatarMenu && (
                <div className="absolute right-0 top-11 w-56 z-50 bg-white dark:bg-dark-card border rounded-xl shadow-2xl py-2">
                  <div className="px-3 py-1.5 border-b mb-1">
                    <div className="text-xs font-bold truncate">{currentUser.name}</div>
                    <div className="text-[10px] text-slate-400">{currentUser.role.replace('_', ' ')} • {currentUser.department}</div>
                  </div>
                  <button
                    onClick={() => { setIsAccountOpen(true); setShowAvatarMenu(false); }}
                    className="w-full text-left px-3 py-2 text-xs font-bold hover:bg-slate-100 dark:hover:bg-dark-surface"
                  >
                    My Account (details, PIN, password)
                  </button>
                  <button
                    onClick={() => { putToSleep(); setShowAvatarMenu(false); }}
                    className="w-full text-left px-3 py-2 text-xs font-bold hover:bg-slate-100 dark:hover:bg-dark-surface"
                  >
                    Lock workstation
                  </button>
                  <button
                    onClick={() => {
                      // Sign-out now waits for queued writes before revoking the
                      // session, so it is not instant. Say so, rather than
                    // letting a clinician click it three times and wonder.
                      setIsSigningOut(true);
                      void signOut().finally(() => setIsSigningOut(false));
                      setShowAvatarMenu(false);
                    }}
                    disabled={isSigningOut}
                    className="w-full text-left px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-60"
                  >
                    {isSigningOut ? 'Signing out…' : 'Sign out'}
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Upper Right: Flat Sign In Button */
          <button
            onClick={onOpenSignInModal}
            className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-all hover:shadow"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign In</span>
          </button>
        )}
      </div>

      {/* Online Booking Modal */}
      <OnlineBookingModal
        isOpen={isBookingModalOpen}
        onClose={() => setIsBookingModalOpen(false)}
      />

      {/* My Account (self-service details / PIN / password) */}
      <AccountModal
        isOpen={isAccountOpen}
        onClose={() => setIsAccountOpen(false)}
      />
    </header>
  );
};
