import React, { useState } from 'react';
import { MainNavId, Sidebar1 } from './components/layout/Sidebar1';
import { SubNavId, Sidebar2 } from './components/layout/Sidebar2';
import { MainContainer } from './components/layout/MainContainer';
import { Header } from './components/layout/Header';
import { PinLockModal } from './components/common/PinLockModal';
import { AuthModal } from './components/common/AuthModal';
import { AuditLogModal } from './components/common/AuditLogModal';
import { PatientProfileDialog } from './components/patients/PatientProfileDialog';
import { PatientRegistration } from './components/patients/PatientRegistration';
import { Patient, Visit } from './types';
import { db } from './services/db';
import { useAuth } from './context/AuthContext';
import { LogIn } from 'lucide-react';

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

  const { isAuthenticated } = useAuth();

  // Audit Log Modal State
  const [auditLogModalOpen, setAuditLogModalOpen] = useState<boolean>(false);
  const [auditFilterPatientId, setAuditFilterPatientId] = useState<string | undefined>(undefined);
  const [auditFilterPatientName, setAuditFilterPatientName] = useState<string | undefined>(undefined);

  // When clicking a main navigation item in Sidebar 1
  const handleSelectNav = (navId: MainNavId) => {
    setActiveNav(navId);
    setIsViewingVisitTabs(false);
    // Entering Physician/Nurse workspace: show the patient list first
    if (navId === 'clinical') {
      setSelectedPatient(null);
      setSelectedVisit(null);
    }

    // Set sensible default sub-navigation
    switch (navId) {
      case 'dashboard': setActiveSubNav('overview'); break;
      case 'patients': setActiveSubNav('all_patients'); break;
      case 'clinical': setActiveSubNav('consultations'); break;
      case 'laboratory': setActiveSubNav('lab_all'); break;
      case 'pharmacy': setActiveSubNav('rx_queue'); break;
      case 'radiology': setActiveSubNav('radiology_all'); break;
      case 'physiotherapy': setActiveSubNav('physio_all'); break;
      case 'billing': setActiveSubNav('all_invoices'); break;
      case 'analytics': setActiveSubNav('patient_stats'); break;
      case 'ai': setActiveSubNav('nl_query'); break;
      case 'admin': setActiveSubNav('users_mgmt'); break;
      default: setActiveSubNav('overview');
    }
  };

  // When clicking a sub-navigation item in Sidebar 2
  const handleSelectSubNav = (subNavId: SubNavId) => {
    setActiveSubNav(subNavId);
    setIsViewingVisitTabs(false);
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

  // Signed-out gate: workstation locked until staff sign in again.
  if (!isAuthenticated) {
    return (
      <div className="w-screen h-screen overflow-hidden flex items-center justify-center bg-light-bg dark:bg-dark-bg p-6">
        <div className="w-full max-w-sm p-8 rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-2xl text-center space-y-4">
          <div className="w-14 h-14 mx-auto rounded-full bg-gradient-to-tr from-emerald-600 via-teal-500 to-emerald-400 flex items-center justify-center text-white text-2xl font-black shadow-md">
            F
          </div>
          <div>
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">FatClinic Workstation</h2>
            <p className="text-xs text-slate-500 mt-1">You signed out. Patient data is hidden until you sign in again.</p>
          </div>
          <button
            onClick={() => setIsAuthModalOpen(true)}
            className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md flex items-center justify-center space-x-2"
          >
            <LogIn className="w-4 h-4" />
            <span>Sign In</span>
          </button>
        </div>

        <AuthModal
          isOpen={isAuthModalOpen}
          onClose={() => setIsAuthModalOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="w-screen h-screen overflow-hidden flex flex-col bg-light-bg dark:bg-dark-bg text-light-text dark:text-dark-text transition-colors duration-200">
      
      {/* Seamless Header - identical color to body, NO border or elevation */}
      <Header
        onNavigateHome={() => handleSelectNav('dashboard')}
        onOpenSignInModal={() => setIsAuthModalOpen(true)}
        onOpenAuditLogs={() => handleOpenAuditLog()}
        onSelectPatient={(patient) => {
          setSelectedPatient(patient);
          handleOpenPatientProfile(patient);
        }}
      />

      {/* Workstation Workspace (Normal 10% - 20% - 70% or Broad View 100%) */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Sidebar 1 & 2 (Hidden in Wide/Broad View) */}
        {!isWideMode && (
          <>
            <Sidebar1
              activeNav={activeNav}
              onSelectNav={handleSelectNav}
            />

            <Sidebar2
              activeNav={activeNav}
              activeSubNav={activeSubNav}
              onSelectSubNav={handleSelectSubNav}
            />
          </>
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
          onNavigate={(nav, sub) => {
            setActiveNav(nav);
            setActiveSubNav(sub);
            setIsViewingVisitTabs(false);
            if (nav === 'clinical') {
              setSelectedPatient(null);
              setSelectedVisit(null);
            }
          }}
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
