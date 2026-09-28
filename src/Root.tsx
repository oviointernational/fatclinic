/**
 * The single entry component that decides which face of the app to render.
 *
 *   /       -> LandingPage (the public site)
 *   /staff  -> App (the clinic workstation: sign-in gate, then the dashboard)
 *
 * Two special cases:
 *
 * 1. A signed-in staff member visiting `/` is redirected to /staff. They are a
 *    clinician, not a visitor, and the workstation is where their day happens.
 *    The redirect is an effect (navigate() cannot be called during render), so
 *    a one-frame loader is shown while the URL updates.
 *
 * 2. A password-reset link is carried in the URL *fragment*
 *    (#access_token=...&type=recovery), which Supabase's Site URL points at the
 *    root path. The reset flow lives inside the workstation (App handles
 *    hasResetLink()), so a link arriving at "/" must render App regardless of
 *    the path — otherwise an administrator clicking their reset email would
 *    land on the public page and the link would silently die.
 */
import React, { useEffect, useState } from 'react';
import App from './App';
import { LandingPage } from './components/landing/LandingPage';
import { useAuth } from './context/AuthContext';
import { hasResetLink } from './services/passwordReset';
import { navigate, useRoute } from './router';

const WORKSTATION_TITLE = 'FatClinic - Hospital Management & EHR System';

/** Centered splash shown for the instant before a redirect lands. */
const RedirectSplash: React.FC = () => (
  <div className="h-screen w-screen flex items-center justify-center bg-white dark:bg-dark-bg">
    <div className="w-10 h-10 border-4 border-emerald-500/25 border-t-emerald-500 rounded-full animate-spin" />
  </div>
);

export const Root: React.FC = () => {
  const route = useRoute();
  const { isAuthenticated, isResolvingSession } = useAuth();
  // Snapshot at mount: a reset link cannot appear mid-session (it is a full
  // navigation), so a once-read flag is the honest signal.
  const [arrivedByResetLink] = useState<boolean>(() => hasResetLink());

  const staffRoute = arrivedByResetLink || route === 'staff';

  // Keep the document title honest for whichever face is showing.
  useEffect(() => {
    document.title = staffRoute
      ? WORKSTATION_TITLE
      : 'FatClinic & Medical Specialties — Book an Appointment';
  }, [staffRoute]);

  useEffect(() => {
    if (!arrivedByResetLink && route === 'landing' && isAuthenticated) {
      navigate('/staff');
    }
  }, [route, isAuthenticated, arrivedByResetLink]);

  if (staffRoute) return <App />;

  // On the landing path with a session (or while it is still being resolved),
  // we are about to bounce to /staff — splash, do not flash the public page.
  if (isAuthenticated || isResolvingSession) return <RedirectSplash />;

  return <LandingPage />;
};