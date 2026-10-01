import React, { useState } from 'react';
import { MainNavId, Sidebar1 } from './components/layout/Sidebar1';
import { SubNavId, Sidebar2 } from './components/layout/Sidebar2';
import { MainContainer } from './components/layout/MainContainer';
import { Header } from './components/layout/Header';
import { PinLockModal } from './components/common/PinLockModal';
import { AuthModal } from './components/common/AuthModal';
import { PasswordResetModal } from './components/common/PasswordResetModal';
import { AccountModal } from './components/common/AccountModal';
import { AuditLogModal } from './components/common/AuditLogModal';
import { PatientProfileDialog } from './components/patients/PatientProfileDialog';
import { PatientRegistration } from './components/patients/PatientRegistration';
import { Patient, Visit } from './types';
import { db } from './services/db';
import { hasResetLink } from './services/passwordReset';
import { useAuth } from './context/AuthContext';
import { useAccess } from './hooks/useAccess';
import { LogIn, ShieldAlert } from 'lucide-react';

export const App: React.FC = () => {
  // Navigation State
  const [activeNav, setActiveNav] = useState<MainNavId>('dashboard');
  const [activeSubNav, setActiveSubNav] = useState<SubNavId>('overview');
  const [isWideMode, setIsWideMode] = useState<boolean>(false);

  // Patient Selection & Modal States
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(() => db.getPatients()[0] || null);
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null);

  const [isViewingVisitTabs, setIsViewingVisitTabs] = useState<boolean>(false);
  const [profileModalPatient, setProfileModalPatient] = useState<Patient | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [isRegistrationOpen, setIsRegistrationOpen] = useState<boolean>(false);
  const [isPasswordResetOpen, setIsPasswordResetOpen] = useState<boolean>(false);

  // Mobile navigation drawer. False means the menu and submenu are off screen and
  // the workspace has the whole display, which is the default: on a phone, two
  // columns of navigation leave the content unreadable.
  const [isMobileNavOpen, setIsMobileNavOpen] = useState<boolean>(false);

  // Read once, at mount. A reset link arrives in the URL fragment and the
  // fragment is cleared the moment the new password is accepted, so this has to
  // be a snapshot rather than a value recomputed on every render.
  const [arrivedByResetLink] = useState<boolean>(() => hasResetLink());

  const { isAuthenticated, isResolvingSession, currentUser, signOut } = useAuth();
  const access = useAccess();

  // Why the last navigation was refused, shown once at the top of the workspace.
  // A refusal that lands somewhere silently reads as a broken application; a
  // refusal that says "that is not part of your role" reads as the system working.
  const [routeNotice, setRouteNotice] = useState<string | null>(null);

  /**
   * The only way to change where the application is looking.
   *
   * Every navigation goes through here - the menu, a button on another screen,
   * `onNavigate` passed into a dashboard. Each is asked whether the destination is
   * one this person may open, and if not, the person is moved to the first thing
   * they may see and told why. Not rendering a menu item is not enough on its
   * own, because `onNavigate` can be called by any screen at any time.
   */
  const goTo = (navId: MainNavId, subNavId: SubNavId) => {
    const decision = access.resolveRoute(navId, subNavId);

    if (!decision.nav || !decision.sub) {
      setRouteNotice(
        'This account has no screens assigned to it. An administrator can grant access under Administration → Roles & Permissions.',
      );
      return;
    }

    setRouteNotice(decision.refused);
    setActiveNav(decision.nav);
    setActiveSubNav(decision.sub);
    setIsViewingVisitTabs(false);

    // Entering the Physician/Nurse workspace shows the patient list first rather
    // than whatever was open, so a stale selection is never acted on by mistake.
    if (decision.nav === 'clinical') {
      setSelectedPatient(null);
      setSelectedVisit(null);
    }
  };

  // Audit Log Modal State
  const [auditLogModalOpen, setAuditLogModalOpen] = useState<boolean>(false);
  const [auditFilterPatientId, setAuditFilterPatientId] = useState<string | undefined>(undefined);
  const [auditFilterPatientName, setAuditFilterPatientName] = useState<string | undefined>(undefined);

  // When clicking a main navigation item in Sidebar 1
  const handleSelectNav = (navId: MainNavId) => {
    // Entering a department lands on the first screen in it this person may open,
    // not on a hard-coded default that may not be theirs.
    const first = access.permittedSubNavs(navId)[0]?.id ?? '';
    goTo(navId, first);
  };

  // When clicking a sub-navigation item in Sidebar 2
  const handleSelectSubNav = (subNavId: SubNavId) => {
    // Picking a screen on a phone finishes the journey: the drawer closes so the
    // content the person chose is actually visible.
    setIsMobileNavOpen(false);
    goTo(activeNav, subNavId);

    // Entering a Physician/Nurse queue (All / Awaiting / Consulted / Incoming):
    // clear selection so the filtered patient list shows first
    if (
      subNavId === 'consultations' || subNavId.startsWith('consultations_') ||
      subNavId === 'nursing_station' || subNavId.startsWith('nursing_')
    ) {
      setSelectedPatient(null);
      setSelectedVisit(null);
    }
  };

  // Open Patient Profile dialog (with 10% side strip and PDF export)
  const handleOpenPatientProfile = (patient: Patient) => {
    setSelectedPatient(patient);
    setProfileModalPatient(patient);
  };

  // Open Visit Date Tabs view
  const handleOpenVisitTabs = (patient: Patient) => {
    setSelectedPatient(patient);
    setIsViewingVisitTabs(true);
  };

  // Open Audit Log
  const handleOpenAuditLog = (patientId?: string, patientName?: string) => {
    setAuditFilterPatientId(patientId);
    setAuditFilterPatientName(patientName);
    setAuditLogModalOpen(true);
  };

  // Waiting for the boot-time session check, so a clinician with a valid session
  // is not flashed the "you are signed out" card for a frame on every refresh.
  // Without this, isAuthenticated starts false and the gate below would render
  // before Supabase has been asked whether anyone is signed in.
  if (isResolvingSession) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-light-bg dark:bg-dark-bg">
        <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  // A password reset link takes precedence over the signed-out card, including
  // over the "you signed out" screen. Someone who has just followed an
  // administrator's reset link has not signed out, and being told they had would
  // be a confusing thing to read on the way to fixing a password.
  //
  // `arrivedByResetLink` is captured once, at mount, and never recomputed: the
  // URL fragment is cleared as soon as the password is changed, so re-reading it
  // on every render would dismiss the screen the moment the change succeeded.
  if (arrivedByResetLink) {
    return (
      <div className="w-screen h-screen overflow-hidden flex items-center justify-center bg-light-bg dark:bg-dark-bg">
        <PasswordResetModal
          isOpen
          hasResetLink
          onClose={() => setIsPasswordResetOpen(false)}
        />
      </div>
    );
  }

  // Signed-out gate: nothing below this line renders without a session, which is
  // what lets every clinical screen treat `useCurrentUser()` as total.
  if (!isAuthenticated) {
    return (
      <div className="w-screen h-screen overflow-hidden flex items-center justify-center bg-light-bg dark:bg-dark-bg p-6">
        <div className="w-full max-w-sm p-8 rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-2xl text-center space-y-4">
          <div className="w-14 h-14 mx-auto rounded-full bg-gradient-to-tr from-emerald-600 via-teal-500 to-emerald-400 flex items-center justify-center text-white text-2xl font-black shadow-md">
            S
          </div>
          <div>
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">Solace Medicare Consult Workstation</h2>
            <p className="text-xs text-slate-500 mt-1">You signed out. Patient data is hidden until you sign in again.</p>
          </div>
          <button
            onClick={() => setIsAuthModalOpen(true)}
            className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md flex items-center justify-center space-x-2"
          >
            <LogIn className="w-4 h-4" />
            <span>Sign In</span>
          </button>

          {/* On the signed-out screen rather than only inside the dialog, because
              being locked out and having forgotten the password is exactly when
              the link is needed and there is no reason to make them open a dialog
              to find it. */}
          <button
            onClick={() => setIsPasswordResetOpen(true)}
            className="text-[11px] font-bold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300 underline underline-offset-2"
          >
            Forgotten your password?
          </button>
        </div>

        <AuthModal
          isOpen={isAuthModalOpen}
          onClose={() => setIsAuthModalOpen(false)}
          onOpenPasswordReset={() => {
            setIsAuthModalOpen(false);
            setIsPasswordResetOpen(true);
          }}
        />

        <PasswordResetModal
          isOpen={isPasswordResetOpen}
          hasResetLink={false}
          onClose={() => {
            setIsPasswordResetOpen(false);
            setIsAuthModalOpen(true);
          }}
        />
      </div>
    );
  }

  // A password issued by an administrator has to be replaced before the
  // workstation opens.
  //
  // This gate sits above everything, so no patient record is ever rendered
  // behind a credential an administrator chose and read out over a telephone.
  // The escape hatch matters as much as the lock: someone who cannot get in must
  // still be able to sign out, or a screen with no way off it is a worse failure
  // than the one it prevents. The flag clears itself in AccountModal once
  // Supabase confirms the change, so this releases without a reload.
  if (isAuthenticated && currentUser?.mustChangePassword) {
    return (
      <div className="w-screen h-screen overflow-hidden flex items-center justify-center bg-light-bg dark:bg-dark-bg">
        <AccountModal
          isOpen
          forced
          onClose={() => undefined}
          onSignOut={() => void signOut()}
        />
      </div>
    );
  }

  return (
    <div className="w-screen h-screen overflow-hidden flex flex-col bg-light-bg dark:bg-dark-bg text-light-text dark:text-dark-text transition-colors duration-200">
      
      {/* Seamless Header - identical color to body, NO border or elevation */}
      <Header
        onNavigateHome={() => goTo('dashboard', 'overview')}
        onOpenSignInModal={() => setIsAuthModalOpen(true)}
        onOpenAuditLogs={() => handleOpenAuditLog()}
        onSelectPatient={(patient) => {
          setSelectedPatient(patient);
          handleOpenPatientProfile(patient);
        }}
        isMobileNavOpen={isMobileNavOpen}
        onToggleMobileNav={() => setIsMobileNavOpen(prev => !prev)}
      />

      {/* Why the last navigation was refused. Dismissible, and never left over a
          screen the person did choose. */}
      {routeNotice && (
        <div className="flex items-start gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900 text-[11px] text-amber-800 dark:text-amber-300 flex-shrink-0">
          <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-px" />
          <span className="flex-1">{routeNotice}</span>
          <button
            onClick={() => setRouteNotice(null)}
            className="font-bold underline flex-shrink-0"
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Workstation Workspace (Normal 10% - 20% - 70% or Broad View 100%) */}
      <div className="flex-1 flex overflow-hidden">

        {/* Tapping outside the drawer closes it. Below the header only, so the
            header's own toggle stays reachable. */}
        {isMobileNavOpen && (
          <div
            className="fixed inset-x-0 bottom-0 top-14 z-30 bg-slate-900/50 md:hidden"
            onClick={() => setIsMobileNavOpen(false)}
          />
        )}

        {/* The menu and submenu are one drawer on a phone and two columns on a
            desk. `md:` is where the layout changes, so a phone gets the whole
            workspace by default and the drawer slides over it. */}
        {(!isWideMode || isMobileNavOpen) && (
          <div
            id="fatclinic-nav-drawer"
            className={`${
              isMobileNavOpen
                ? 'fixed top-14 bottom-0 left-0 z-40 flex shadow-2xl'
                : 'hidden md:flex'
            } flex-shrink-0`}
          >
            <Sidebar1
              activeNav={activeNav}
              onSelectNav={handleSelectNav}
              asDrawer={isMobileNavOpen}
            />

            <Sidebar2
              activeNav={activeNav}
              activeSubNav={activeSubNav}
              onSelectSubNav={handleSelectSubNav}
              asDrawer={isMobileNavOpen}
            />
          </div>
        )}

        {/* Main Container */}
        <MainContainer
          activeNav={activeNav}
          activeSubNav={activeSubNav}
          selectedPatient={selectedPatient}
          selectedVisit={selectedVisit}
          onSelectPatient={setSelectedPatient}
          onSelectVisit={setSelectedVisit}
          onOpenPatientProfile={handleOpenPatientProfile}
          onOpenVisitTabs={handleOpenVisitTabs}
          onBackFromVisitTabs={() => setIsViewingVisitTabs(false)}
          isViewingVisitTabs={isViewingVisitTabs}
          onOpenAuditLog={handleOpenAuditLog}
          onOpenRegistration={() => setIsRegistrationOpen(true)}
          onNavigate={(nav, sub) => goTo(nav, sub)}
          isWideMode={isWideMode}
          onToggleWideMode={() => setIsWideMode(prev => !prev)}
        />
      </div>

      {/* 4-Digit Device PIN Sleep & Wake-up Modal */}
      <PinLockModal />

      {/* Staff Sign-In / Register Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onOpenPasswordReset={() => {
          setIsAuthModalOpen(false);
          setIsPasswordResetOpen(true);
        }}
      />

      {/* Forgotten password. Reachable while signed in too, because an
          administrator can be working on a shared workstation and realise
          mid-session that the password they signed in with is the one they will
          need again tomorrow. */}
      <PasswordResetModal
        isOpen={isPasswordResetOpen}
        hasResetLink={false}
        onClose={() => setIsPasswordResetOpen(false)}
      />

      {/* Patient Profile Dialog (10% side strip + 90% tabs + PDF export) */}
      <PatientProfileDialog
        patient={profileModalPatient}
        onClose={() => setProfileModalPatient(null)}
        onOpenAuditLog={handleOpenAuditLog}
        onOpenVisitTabs={(p) => {
          setProfileModalPatient(null);
          handleOpenVisitTabs(p);
        }}
      />

      {/* Front Desk Patient Registration Modal */}
      <PatientRegistration
        isOpen={isRegistrationOpen}
        onClose={() => setIsRegistrationOpen(false)}
        onSuccess={(newPatient) => {
          setSelectedPatient(newPatient);
          handleOpenPatientProfile(newPatient);
        }}
      />

      {/* Immutable Audit Log Modal */}
      <AuditLogModal
        isOpen={auditLogModalOpen}
        onClose={() => setAuditLogModalOpen(false)}
        patientId={auditFilterPatientId}
        patientName={auditFilterPatientName}
      />
    </div>
  );
};
export default App;
