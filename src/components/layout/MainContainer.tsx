import React from 'react';
import { MainNavId } from './Sidebar1';
import { SubNavId } from './Sidebar2';
import { Patient, Visit } from '../../types';
import { ExecutiveDashboard } from '../dashboard/ExecutiveDashboard';
import { PatientList } from '../patients/PatientList';
import { VisitTabsView } from '../patients/VisitTabsView';
import { ConsultationForm } from '../clinical/ConsultationForm';
import { NursingStation } from '../clinical/NursingStation';
import { LabDashboard } from '../laboratory/LabDashboard';
import { PharmacyDashboard } from '../pharmacy/PharmacyDashboard';
import { RadiologyDashboard } from '../radiology/RadiologyDashboard';
import { PhysiotherapyDashboard } from '../physiotherapy/PhysiotherapyDashboard';
import { CentralBilling } from '../billing/CentralBilling';
import { AnalyticsDashboard } from '../analytics/AnalyticsDashboard';
import { AIAssistantModal } from '../ai/AIAssistantModal';
import { AdminDashboard } from '../admin/AdminDashboard';
import { OnlineBookingsLookup } from '../frontdesk/OnlineBookingsLookup';
import { FrontDeskCashier } from '../frontdesk/FrontDeskCashier';
import { LabOverview } from '../laboratory/LabOverview';
import { LabStockManagement } from '../laboratory/LabStockManagement';
import { LabTestInventory } from '../laboratory/LabTestInventory';
import { PharmacyOverview } from '../pharmacy/PharmacyOverview';
import { SectionConsumablesPanel } from '../common/SectionConsumablesPanel';
import { ClinicalDashboardPage } from '../clinical/ClinicalDashboardPage';
import { RadiologyOverview } from '../radiology/RadiologyOverview';
import { PhysiotherapyOverview } from '../physiotherapy/PhysiotherapyOverview';
import { Maximize2, Minimize2, User, Clock } from 'lucide-react';

interface MainContainerProps {
  activeNav: MainNavId;
  activeSubNav: SubNavId;
  selectedPatient: Patient | null;
  selectedVisit: Visit | null;
  onSelectPatient: (patient: Patient) => void;
  onSelectVisit?: (visit: Visit | null) => void;
  onOpenPatientProfile: (patient: Patient) => void;
  onOpenVisitTabs: (patient: Patient) => void;
  onBackFromVisitTabs: () => void;
  isViewingVisitTabs: boolean;
  onOpenAuditLog: (patientId?: string, patientName?: string) => void;
  onOpenRegistration: () => void;
  onNavigate: (nav: MainNavId, subNav: SubNavId) => void;
  isWideMode?: boolean;
  onToggleWideMode?: () => void;
}

export const MainContainer: React.FC<MainContainerProps> = ({
  activeNav,
  activeSubNav,
  selectedPatient,
  selectedVisit,
  onSelectPatient,
  onSelectVisit,
  onOpenPatientProfile,
  onOpenVisitTabs,
  onBackFromVisitTabs,
  onOpenAuditLog,
  onOpenRegistration,
  isViewingVisitTabs,
  onNavigate,
  isWideMode = false,
  onToggleWideMode
}) => {
  // NOTE: no auto-selected patient — Physician/Nurse queue views show the
  // filtered patient list first; details open only after a patient is clicked.

  // Preset clinical-dashboard filter when jumping from Executive Overview.
  const [dashPreset, setDashPreset] = React.useState<{ group: string | null; ward: string | null } | null>(null);
  const handleOpenClinicalGroup = (groupId: string | null, ward?: string | null) => {
    setDashPreset({ group: groupId, ward: ward || null });
    onNavigate('clinical', 'clinical_dashboard');
  };

  // If user clicked "Visit Tabs" from a patient
  if (isViewingVisitTabs && selectedPatient) {
    return (
      <main className={`${isWideMode ? 'w-full' : 'w-[70%]'} h-full flex flex-col overflow-hidden bg-light-bg dark:bg-dark-bg transition-all duration-300`}>
        <div className="flex-shrink-0 px-4 py-2 border-b border-light-border dark:border-dark-border bg-white dark:bg-dark-card flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2">
            <span className="font-extrabold text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Encounter Tabs</span>
            <span className="text-slate-300 dark:text-slate-600">/</span>
            <button
              onClick={() => onOpenPatientProfile(selectedPatient)}
              className="flex items-center space-x-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 px-2 py-0.5 rounded-lg transition-colors group cursor-pointer"
              title="Open full Patient EHR Profile"
            >
              <User className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="font-bold text-slate-800 dark:text-slate-200 group-hover:text-emerald-600 group-hover:underline">
                {selectedPatient.firstName} {selectedPatient.lastName}
              </span>
              <span className="font-mono text-[10px] text-slate-400">({selectedPatient.id})</span>
            </button>
          </div>

          {onToggleWideMode && (
            <button
              onClick={onToggleWideMode}
              title={isWideMode ? "Restore standard 3-column workspace" : "Expand to broad view"}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all shadow-sm ${
                isWideMode
                  ? 'bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                  : 'bg-slate-100 hover:bg-slate-200 dark:bg-dark-surface text-slate-700 dark:text-slate-200 border border-light-border dark:border-dark-border'
              }`}
            >
              {isWideMode ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Normal View</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                  <span>Broad View</span>
                </>
              )}
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          <VisitTabsView
            patient={selectedPatient}
            onBack={onBackFromVisitTabs}
            onOpenConsultation={(v) => {
              if (onSelectVisit) onSelectVisit(v);
              onNavigate('clinical', 'consultations');
            }}
            onOpenNursingStation={(v) => {
              if (onSelectVisit) onSelectVisit(v);
              onNavigate('clinical', 'nursing_station');
            }}
          />
        </div>
      </main>
    );
  }

  const renderContent = () => {
    switch (activeNav) {
      case 'dashboard':
        if (activeSubNav === 'analytics') {
          return <AnalyticsDashboard />;
        }
        // Non-compliant legacy dashboard queues removed from workflow — fall through to overview
        if (activeSubNav === 'physician_queue' || activeSubNav === 'nursing_queue') {
          return (
            <ExecutiveDashboard
              onNavigatePatients={() => onNavigate('patients', 'all_patients')}
              onNavigateClinical={() => onNavigate('clinical', 'consultations')}
              onNavigateLab={(cat) => onNavigate('laboratory', (cat as any) || 'lab_all')}
              onNavigatePharmacy={() => onNavigate('pharmacy', 'rx_queue')}
              onNavigateRadiology={() => onNavigate('radiology', 'radiology_all')}
              onNavigatePhysiotherapy={() => onNavigate('physiotherapy', 'physio_all')}
              onNavigateBilling={() => onNavigate('patients', 'central_billing')}
              onOpenClinicalGroup={handleOpenClinicalGroup}
              onSelectPatient={(p) => {
                onSelectPatient(p);
                onOpenPatientProfile(p);
              }}
            />
          );
        }
        // Diagnostic Alerts moved to Clinical Care & Triage — legacy dashboard route falls through to overview
        if ((activeSubNav as string) === 'lab_alerts') {
          return (
            <ExecutiveDashboard
              onNavigatePatients={() => onNavigate('patients', 'all_patients')}
              onNavigateClinical={() => onNavigate('clinical', 'consultations')}
              onNavigateLab={(cat) => onNavigate('laboratory', (cat as any) || 'lab_all')}
              onNavigatePharmacy={() => onNavigate('pharmacy', 'rx_queue')}
              onNavigateRadiology={() => onNavigate('radiology', 'radiology_all')}
              onNavigatePhysiotherapy={() => onNavigate('physiotherapy', 'physio_all')}
              onNavigateBilling={() => onNavigate('patients', 'central_billing')}
              onOpenClinicalGroup={handleOpenClinicalGroup}
              onSelectPatient={(p) => {
                onSelectPatient(p);
                onOpenPatientProfile(p);
              }}
            />
          );
        }
        return (
          <ExecutiveDashboard
            onNavigatePatients={() => onNavigate('patients', 'all_patients')}
            onNavigateClinical={() => onNavigate('clinical', 'consultations')}
            onNavigateLab={(cat) => onNavigate('laboratory', (cat as any) || 'lab_all')}
            onNavigatePharmacy={() => onNavigate('pharmacy', 'rx_queue')}
            onNavigateRadiology={() => onNavigate('radiology', 'radiology_all')}
            onNavigatePhysiotherapy={() => onNavigate('physiotherapy', 'physio_all')}
            onNavigateBilling={() => onNavigate('patients', 'central_billing')}
            onOpenClinicalGroup={handleOpenClinicalGroup}
            onSelectPatient={(p) => {
              onSelectPatient(p);
              onOpenPatientProfile(p);
            }}
          />
        );

      case 'patients':
        if (activeSubNav === 'online_bookings') return <OnlineBookingsLookup onOpenProfile={onOpenPatientProfile} />;
        if (activeSubNav === 'pay_bills') return <FrontDeskCashier onOpenTimeline={(p) => onOpenVisitTabs(p)} onOpenProfile={onOpenPatientProfile} />;
        // Central Billing lives under Front Desk: same synchronized invoice store as the Cashier
        if (activeSubNav === 'central_billing') return <CentralBilling initialTab="invoices" />;
        if (activeSubNav === 'price_schedule') return <CentralBilling initialTab="pricing" />;
        // Front Desk Billing removed — universal sitewide billing lives in Pay Bill / Cashier
        if ((activeSubNav as string) === 'front_desk_billing') return <FrontDeskCashier onOpenTimeline={(p) => onOpenVisitTabs(p)} onOpenProfile={onOpenPatientProfile} />;
        if ((activeSubNav as string) === 'register_patient') {
          return (
            <PatientList
              onSelectProfile={onOpenPatientProfile}
              onSelectVisitTabs={onOpenVisitTabs}
              onOpenAuditLog={onOpenAuditLog}
              onOpenRegistration={onOpenRegistration}
            />
          );
        }
        if (activeSubNav === 'patient_timeline') {
          if (!selectedPatient) {
            return (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 bg-white dark:bg-dark-card rounded-2xl border border-light-border dark:border-dark-border m-4 p-8 text-center">
                <Clock className="w-10 h-10 mb-2 opacity-40" />
                <p className="font-bold text-sm text-slate-600 dark:text-slate-300">No patient selected for timeline</p>
                <p className="text-xs mt-1">Pick a patient from the Patient Directory & Queue first — their encounter tabs will open here.</p>
                <button
                  onClick={() => onNavigate('patients', 'all_patients')}
                  className="mt-4 px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white"
                >
                  Open Patient Directory
                </button>
              </div>
            );
          }
          return (
            <VisitTabsView
              patient={selectedPatient}
              onBack={() => onNavigate('patients', 'all_patients')}
              onOpenConsultation={(v) => {
                if (onSelectVisit) onSelectVisit(v);
                onNavigate('clinical', 'consultations');
              }}
              onOpenNursingStation={(v) => {
                if (onSelectVisit) onSelectVisit(v);
                onNavigate('clinical', 'nursing_station');
              }}
            />
          );
        }
        return (
          <PatientList
            onSelectProfile={onOpenPatientProfile}
            onSelectVisitTabs={onOpenVisitTabs}
            onOpenAuditLog={onOpenAuditLog}
            onOpenRegistration={onOpenRegistration}
          />
        );

      case 'clinical':
        if (activeSubNav === 'clinical_dashboard') {
          return (
            <ClinicalDashboardPage
              onOpenProfile={onOpenPatientProfile}
              onSelectPatient={onSelectPatient}
              onSelectVisit={(v) => onSelectVisit && onSelectVisit(v)}
              onNavigateConsultation={() => onNavigate('clinical', 'consultations')}
              onNavigateNursing={() => onNavigate('clinical', 'nursing_station')}
              initialGroup={dashPreset?.group}
              initialWard={dashPreset?.ward}
            />
          );
        }
        if (activeSubNav === 'nursing_consumables') {
          return (
            <div className="h-full overflow-y-auto p-4 md:p-6">
              <SectionConsumablesPanel
                section="Nursing"
                title="Nursing Consumables"
                subtitle="Nursing + General items, harmonized with Administration. Request restock or log usage — stock is subtracted and patient-linked usage posts to the visit invoice. Prices are set by Administration."
                accentClass="bg-teal-600 hover:bg-teal-700"
              />
            </div>
          );
        }
        if (activeSubNav === 'nursing_station' || activeSubNav.startsWith('nursing_')) {
          return (
            <NursingStation
              selectedVisit={selectedVisit || undefined}
              selectedPatient={selectedPatient || undefined}
              onSelectPatient={onSelectPatient}
              onSelectVisit={(v) => onSelectVisit && onSelectVisit(v)}
              onOpenProfile={onOpenPatientProfile}
              activeSubNav={activeSubNav}
            />
          );
        }
        if (activeSubNav === 'lab_alerts') {
          return <LabDashboard alertsOnly />;
        }
        return (
          <ConsultationForm
            patient={selectedPatient}
            visit={selectedVisit || undefined}
            onSelectPatient={onSelectPatient}
            onOpenProfile={onOpenPatientProfile}
            isWideMode={isWideMode}
            onToggleWideMode={onToggleWideMode}
            activeSubNav={activeSubNav}
          />
        );

      case 'laboratory':
        if (activeSubNav === 'lab_overview') {
          return (
            <LabOverview 
              onNavigateDepartment={(cat) => onNavigate('laboratory', cat.toLowerCase() as any)} 
            />
          );
        }
        if (activeSubNav === 'lab_stock') {
          return <LabStockManagement />;
        }
        if (activeSubNav === 'lab_inventory') {
          return <LabTestInventory />;
        }
        if (activeSubNav === 'hematology') return <LabDashboard initialCategory="HEMATOLOGY" />;
        if (activeSubNav === 'microbiology') return <LabDashboard initialCategory="MICROBIOLOGY" />;
        if (activeSubNav === 'chemical_pathology') return <LabDashboard initialCategory="CHEMICAL_PATHOLOGY" />;
        if (activeSubNav === 'histopathology') return <LabDashboard initialCategory="HISTOPATHOLOGY" />;
        if (activeSubNav === 'molecular') return <LabDashboard initialCategory="MOLECULAR" />;
        if (activeSubNav === 'lab_released') return <LabDashboard initialStatus="Released" />;
        return <LabDashboard />;

      case 'pharmacy':
        if (activeSubNav === 'pharmacy_overview') {
          return (
            <PharmacyOverview
              onNavigateQueue={() => onNavigate('pharmacy', 'rx_queue')}
              onNavigateInventory={() => onNavigate('pharmacy', 'inventory')}
            />
          );
        }
        if (activeSubNav === 'pharmacy_stock_requests') return <PharmacyDashboard initialTab="requests" />;
        if (activeSubNav === 'inventory' || activeSubNav === 'pharmacy_inventory') return <PharmacyDashboard initialTab="inventory" />;
        if (activeSubNav === 'pharmacy_consumables') return <PharmacyDashboard initialTab="consumables" />;
        if (activeSubNav === 'dispensed') return <PharmacyDashboard initialTab="dispensed" />;
        return <PharmacyDashboard initialTab="queue" />;

      case 'radiology': {
        if (activeSubNav === 'radiology_overview') {
          const modalityToSub: Record<string, any> = {
            'X-Ray': 'xray', 'Ultrasound': 'ultrasound', 'CT Scan': 'ct_scan', 'MRI': 'mri',
          };
          return (
            <RadiologyOverview
              onNavigateModality={(m) => onNavigate('radiology', modalityToSub[m] || 'radiology_all')}
              onNavigateStock={() => onNavigate('radiology', 'radiology_stock')}
              onNavigateReports={() => onNavigate('radiology', 'radiology_reports')}
            />
          );
        }
        let initialModality: any = undefined;
        let initialTab: any = 'queue';
        let initialStatus: any = undefined;
        if (activeSubNav === 'xray') initialModality = 'X-Ray';
        else if (activeSubNav === 'ultrasound') initialModality = 'Ultrasound';
        else if (activeSubNav === 'ct_scan') initialModality = 'CT Scan';
        else if (activeSubNav === 'mri') initialModality = 'MRI';
        else if (activeSubNav === 'radiology_reports') initialStatus = 'Completed';
        else if (activeSubNav === 'radiology_stock') initialTab = 'stock';
        else if (activeSubNav === 'radiology_pricing') initialTab = 'pricing';
        return (
          <RadiologyDashboard
            initialModality={initialModality}
            initialTab={initialTab}
            initialStatus={initialStatus}
          />
        );
      }

      case 'physiotherapy': {
        if (activeSubNav === 'physio_overview') {
          const categoryToSub: Record<string, any> = {
            'Musculoskeletal': 'musculoskeletal', 'Neurological': 'neuro_rehab',
            'Sports': 'sports_physio', 'Pediatric': 'pediatric_physio',
          };
          return (
            <PhysiotherapyOverview
              onNavigateCategory={(c) => onNavigate('physiotherapy', categoryToSub[c] || 'physio_all')}
              onNavigateSessions={() => onNavigate('physiotherapy', 'physio_sessions')}
              onNavigateEquipment={() => onNavigate('physiotherapy', 'physio_equipment')}
            />
          );
        }
        let initialCategory: any = undefined;
        let initialTab: any = 'queue';
        let initialStatus: any = undefined;
        if (activeSubNav === 'musculoskeletal') initialCategory = 'Musculoskeletal';
        else if (activeSubNav === 'neuro_rehab') initialCategory = 'Neurological';
        else if (activeSubNav === 'sports_physio') initialCategory = 'Sports';
        else if (activeSubNav === 'pediatric_physio') initialCategory = 'Pediatric';
        else if (activeSubNav === 'physio_sessions') initialStatus = 'In Progress';
        else if (activeSubNav === 'physio_equipment') initialTab = 'equipment';
        else if (activeSubNav === 'physio_pricing') initialTab = 'pricing';
        return (
          <PhysiotherapyDashboard
            initialCategory={initialCategory}
            initialTab={initialTab}
            initialStatus={initialStatus}
          />
        );
      }

      case 'billing':
        if (activeSubNav === 'price_schedule') return <CentralBilling initialTab="pricing" />;
        return <CentralBilling initialTab="invoices" />;

      case 'analytics':
        return <AnalyticsDashboard />;

      case 'ai':
        if (activeSubNav === 'ai_summarizer') {
          return <AIAssistantModal initialMode="summarizer" onSelectPatient={onSelectPatient} />;
        }
        if (activeSubNav === 'ai_safety') {
          return <AIAssistantModal initialMode="safety" onSelectPatient={onSelectPatient} />;
        }
        return <AIAssistantModal initialMode="query" onSelectPatient={onSelectPatient} />;

      case 'admin':
        if (activeSubNav === 'users_mgmt') return <AdminDashboard initialTab="users" />;
        if (activeSubNav === 'consumables_mgmt') return <AdminDashboard initialTab="consumables" />;
        if (activeSubNav === 'lab_mgmt') return <AdminDashboard initialTab="lab" />;
        if (activeSubNav === 'pharmacy_mgmt') return <AdminDashboard initialTab="pharmacy" />;
        if (activeSubNav === 'radiology_physio_mgmt') return <AdminDashboard initialTab="radiology_physio" />;
        if (activeSubNav === 'receipt_settings') return <AdminDashboard initialTab="receipts" />;
        if (activeSubNav === 'system_settings') return <AdminDashboard initialTab="settings" />;
        return <AdminDashboard initialTab="pricing" />;

      default:
        return (
          <ExecutiveDashboard
            onNavigatePatients={() => onNavigate('patients', 'all_patients')}
            onNavigateClinical={() => onNavigate('clinical', 'consultations')}
            onNavigateLab={(cat) => onNavigate('laboratory', (cat as any) || 'lab_all')}
            onNavigatePharmacy={() => onNavigate('pharmacy', 'rx_queue')}
            onNavigateRadiology={() => onNavigate('radiology', 'radiology_all')}
            onNavigatePhysiotherapy={() => onNavigate('physiotherapy', 'physio_all')}
            onNavigateBilling={() => onNavigate('patients', 'central_billing')}
            onOpenClinicalGroup={handleOpenClinicalGroup}
            onSelectPatient={onOpenPatientProfile}
          />
        );
    }
  };

  return (
    <main className={`${isWideMode ? 'w-full' : 'w-[70%]'} h-full flex flex-col overflow-hidden bg-light-bg dark:bg-dark-bg transition-all duration-300`}>
      <div className="flex-1 overflow-y-auto">
        {renderContent()}
      </div>
    </main>
  );
};
