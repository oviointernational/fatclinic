import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User } from '../types';
import { db } from '../services/db';
import { whenDrained, pendingKeys } from '../services/sync';
import * as auth from '../services/auth';
import type { AuthOutcome } from '../services/auth';

interface AuthContextType {
  /**
   * The signed-in staff member, or null when signed out.
   *
   * Nullable on purpose. The previous build defaulted it to `allUsers[0]`, so
   * there was always a "current user" even with nobody signed in - which meant
   * an audit entry could be attributed to a person who had not authenticated.
   * Use `useCurrentUser()` inside the authenticated shell, where the value is
   * guaranteed.
   */
  currentUser: User | null;
  isAuthenticated: boolean;
  /** True until a stored session has been checked on boot. Show a loader, not the gate. */
  isResolvingSession: boolean;
  signIn: (email: string, password: string) => Promise<AuthOutcome>;
  signOut: () => Promise<void>;
  isSleeping: boolean;
  devicePin: string;
  setDevicePin: (pin: string) => void;
  putToSleep: () => void;
  wakeUpWithPin: (pin: string) => boolean;
  setCurrentUser: (u: User) => void;
  allUsers: User[];
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [allUsers, setAllUsers] = useState<User[]>(() => db.getUsers());
  const [currentUser, setCurrentUserState] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isResolvingSession, setIsResolvingSession] = useState(true);
  const [isSleeping, setIsSleeping] = useState(false);
  const [devicePin, setDevicePinState] = useState<string>(() => {
    return localStorage.getItem('fatclinic_device_pin') || '1234';
  });

  // Keep allUsers synced with DB changes
  useEffect(() => {
    return db.subscribe(() => {
      setAllUsers(db.getUsers());
    });
  }, []);

  // Apply a session (or its absence) to app state. The single place that decides
  // who is signed in, so boot restore, sign-in and sign-out cannot disagree.
  const applySession = useCallback(async (resolve: () => Promise<AuthOutcome>) => {
    const outcome = await resolve();
    if (outcome.ok) {
      setCurrentUserState(outcome.user);
      setIsAuthenticated(true);
      setIsSleeping(false);
      // The database hydrated once at import, which on a cold load was before
      // there was any session, so it saw nothing. Pull the server's copy now that
      // RLS will actually admit this request - otherwise a clinician signs in
      // and sees an empty register while their colleagues' patients sit in
      // Postgres, unreachable from the browser.
      void db.resync();
    } else {
      setCurrentUserState(null);
      setIsAuthenticated(false);
      setIsSleeping(false);
    }
  }, []);

  // Boot: restore the stored session and re-check the staff profile.
  //
  // The re-check is not redundant. A session can outlive the profile it belongs
  // to - the account was disabled, or the profile deleted - and Supabase will
  // happily hand back a still-valid JWT for it. Resolving the profile again is
  // what makes disabling a staff member actually take effect.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const session = await auth.getSession();
        if (cancelled) return;
        if (!session) {
          setIsAuthenticated(false);
          setCurrentUserState(null);
          return;
        }
        const email = session.user?.email ?? '';
        const outcome = await auth.resolveProfile(email);
        if (cancelled) return;
        if (outcome.ok) {
          setCurrentUserState(outcome.user);
          setIsAuthenticated(true);
          void db.resync();
        } else {
          console.warn(`[auth] stored session rejected (${outcome.reason}); signing out`);
          await auth.signOut();
          setCurrentUserState(null);
          setIsAuthenticated(false);
        }
      } catch (err) {
        console.error('[auth] session restore failed:', err);
        if (!cancelled) {
          setCurrentUserState(null);
          setIsAuthenticated(false);
        }
      } finally {
        if (!cancelled) setIsResolvingSession(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // A session can also change without this tab asking: sign-out in another tab,
  // or a token that expires mid-consultation. Follow it, so a revoked account
  // does not keep a usable screen.
  useEffect(() => {
    return auth.onAuthChange((session) => {
      void applySession(async () => {
        if (!session) return { ok: false, reason: 'invalid-credentials', message: '' };
        return auth.resolveProfile(session.user?.email ?? '');
      });
    });
  }, [applySession]);

  // Inactivity auto-sleep timer (e.g. 10 minutes or configurable)
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const settings = db.getSettings();
    const timeoutMs = (settings.inactivityTimeoutMinutes || 5) * 60 * 1000;

    const resetTimer = () => {
      clearTimeout(timeout);
      if (isAuthenticated && !isSleeping) {
        timeout = setTimeout(() => {
          setIsSleeping(true);
        }, timeoutMs);
      }
    };

    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    events.forEach(ev => window.addEventListener(ev, resetTimer));
    resetTimer();

    return () => {
      clearTimeout(timeout);
      events.forEach(ev => window.removeEventListener(ev, resetTimer));
    };
  }, [isAuthenticated, isSleeping]);

  const setDevicePin = (newPin: string) => {
    setDevicePinState(newPin);
    localStorage.setItem('fatclinic_device_pin', newPin);
  };

  const putToSleep = () => {
    setIsSleeping(true);
  };

  // Strict account isolation: only the signed-in user's own PIN wakes the
  // workstation. No universal fallback PIN - nobody can open another account.
  const wakeUpWithPin = (enteredPin: string): boolean => {
    if (!currentUser) return false;
    const fresh = db.getUserById(currentUser.id);
    if (enteredPin === (fresh?.pin || currentUser.pin)) {
      setIsSleeping(false);
      return true;
    }
    return false;
  };

  /**
   * Re-read the signed-in profile from the database.
   *
   * The argument is a hint about *which* profile changed, not a value to trust:
   * the object is rebuilt from `db`, so a stale or tampered copy can never
   * become the session user. It is how the account screen reflects an edit
   * immediately instead of after the next reload.
   */
  const setCurrentUser = (u: User) => {
    const fresh = db.getUserById(u.id);
    if (fresh) {
      setCurrentUserState(fresh);
      return;
    }
    console.warn(`[auth] ignoring setCurrentUser for unknown profile ${u.id}`);
  };

  const signIn = async (email: string, password: string): Promise<AuthOutcome> => {
    const outcome = await auth.signIn(email, password);
    if (outcome.ok) {
      setCurrentUserState(outcome.user);
      setIsAuthenticated(true);
      setIsSleeping(false);
      void db.resync();
    }
    return outcome;
  };

  const signOut = async () => {
    // Wait for queued writes before dropping the session. Signing out revokes the
    // JWT, and every write still in flight would then be rejected by RLS and
    // silently left in localStorage - so a clinician who signs out a second
    // after entering a consultation would lose it. `whenDrained` resolves even
    // when writes fail, so this cannot hang on a dead network.
    const outstanding = pendingKeys();
    if (outstanding.length) {
      console.info(`[auth] waiting for ${outstanding.length} pending write(s) before sign-out`);
      await whenDrained();
      const stuck = pendingKeys();
      if (stuck.length) {
        console.error(
          `[auth] ${stuck.length} write(s) did not reach the database before sign-out. ` +
            `They remain in this browser's localStorage: ${stuck.join(', ')}`,
        );
      }
    }

    await auth.signOut();
    setCurrentUserState(null);
    setIsAuthenticated(false);
    setIsSleeping(false);
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isAuthenticated,
        isResolvingSession,
        signIn,
        signOut,
        isSleeping,
        devicePin,
        setDevicePin,
        putToSleep,
        wakeUpWithPin,
        setCurrentUser,
        allUsers
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};

/**
 * The signed-in staff member, guaranteed.
 *
 * Every clinical screen needs one, and App.tsx already refuses to render any of
 * them until there is a session - so the null case is unreachable there. Throwing
 * rather than returning `User | null` keeps that guarantee in the type system,
 * which is the only place it can actually be relied on: spreading `!` across
 * thirty components to silence the compiler is the same as not checking at all.
 */
export const useCurrentUser = (): User => {
  const { currentUser } = useAuth();
  if (!currentUser) {
    throw new Error(
      'useCurrentUser() was called while signed out. Any screen using it must render ' +
        'inside the authenticated shell in App.tsx.',
    );
  }
  return currentUser;
};
