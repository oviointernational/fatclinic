import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '../types';
import { db } from '../services/db';

interface AuthContextType {
  currentUser: User;
  isAuthenticated: boolean;
  isSleeping: boolean;
  devicePin: string;
  setDevicePin: (pin: string) => void;
  putToSleep: () => void;
  wakeUpWithPin: (pin: string) => boolean;
  setCurrentUser: (u: User) => void;
  signIn: (user: User) => void;
  signOut: () => void;
  allUsers: User[];
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [allUsers, setAllUsers] = useState<User[]>(() => db.getUsers());
  const [currentUser, setCurrentUserState] = useState<User>(() => {
    const saved = localStorage.getItem('fatclinic_active_user');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* fallback */ }
    }
    return allUsers[0]; // Dr. Adeleke
  });

  // Production sessions: signed in only if a previous session was saved.
  // Fresh installs boot signed out; signOut() clears the saved session.
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    try {
      return !!localStorage.getItem('fatclinic_active_user');
    } catch (e) {
      return false;
    }
  });
  const [isSleeping, setIsSleeping] = useState<boolean>(false);
  const [devicePin, setDevicePinState] = useState<string>(() => {
    return localStorage.getItem('fatclinic_device_pin') || '1234';
  });

  // Keep allUsers synced with DB changes
  useEffect(() => {
    return db.subscribe(() => {
      setAllUsers(db.getUsers());
    });
  }, []);

  // Save active user
  useEffect(() => {
    localStorage.setItem('fatclinic_active_user', JSON.stringify(currentUser));
  }, [currentUser]);

  // Inactivity auto-sleep timer (e.g. 10 minutes or configurable)
  useEffect(() => {
    let timeout: any;
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
  // workstation. No universal fallback PIN — nobody can open another account.
  const wakeUpWithPin = (enteredPin: string): boolean => {
    const fresh = db.getUserById(currentUser.id);
    if (enteredPin === (fresh?.pin || currentUser.pin)) {
      setIsSleeping(false);
      return true;
    }
    return false;
  };

  const setCurrentUser = (u: User) => {
    setCurrentUserState(u);
  };

  const signIn = (user: User) => {
    setCurrentUserState(user);
    setIsAuthenticated(true);
    setIsSleeping(false);
  };

  const signOut = () => {
    try {
      localStorage.removeItem('fatclinic_active_user');
    } catch (e) {
      /* storage unavailable */
    }
    setIsAuthenticated(false);
    setIsSleeping(false);
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isAuthenticated,
        isSleeping,
        devicePin,
        setDevicePin,
        putToSleep,
        wakeUpWithPin,
        setCurrentUser,
        signIn,
        signOut,
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
