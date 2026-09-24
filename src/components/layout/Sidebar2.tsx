import React, { useState } from 'react';
import { MainNavId } from './Sidebar1';
import { 
  Users, 
  UserPlus, 
  Clock, 
  Stethoscope, 
  Activity, 
  BookOpen, 
  TestTube, 
  Bug, 
  Dna, 
  Microscope, 
  FileCheck2, 
  Inbox, 
  Package, 
  Receipt, 
  CreditCard, 
  Coins, 
  TrendingUp, 
  PieChart, 
  DollarSign, 
  Bot, 
  Sparkles, 
  ShieldCheck, 
  UserCog,
  Sliders,
  Building,
  Globe,
  Boxes,
  FileSpreadsheet,
  Radio,
  BarChart3,
  ChevronUp,
  ChevronDown,
  UserCheck,
  Bell,
  LayoutGrid,
  CheckCircle2
} from 'lucide-react';

export type SubNavId = string;

interface SubMenuItem {
  id: SubNavId;
  label: string;
  description?: string;
  icon: React.ReactNode;
  badge?: string;
  hasSubmenu?: boolean;
  subItems?: SubMenuItem[];
}

interface Sidebar2Props {
  activeNav: MainNavId;
  activeSubNav: SubNavId;
  onSelectSubNav: (id: SubNavId) => void;
}

export const Sidebar2: React.FC<Sidebar2Props> = ({
  activeNav,
  activeSubNav,
  onSelectSubNav
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  const getSubMenuItems = (nav: MainNavId): { title: string; items: SubMenuItem[] } => {
    switch (nav) {
      case 'dashboard':
        return {
          title: 'Executive Dashboard',
          items: [
            { id: 'overview', label: 'Executive Overview', icon: <TrendingUp className="w-4 h-4 text-emerald-500" /> },
            { id: 'analytics', label: 'Analytics & Reports', icon: <BarChart3 className="w-4 h-4 text-teal-500" /> }
          ]
        };

      case 'patients':
        return {
          title: 'Front Desk Operations',
          items: [
            { id: 'all_patients', label: 'Patient Directory & Queue', icon: <Users className="w-4 h-4 text-blue-500" /> },
            { id: 'online_bookings', label: 'Online Bookings & Code', icon: <Globe className="w-4 h-4 text-purple-500" />, badge: 'New' },
            { id: 'pay_bills', label: 'Pay Bill / Cashier', icon: <CreditCard className="w-4 h-4 text-teal-500" /> },
            { id: 'central_billing', label: 'Central Billing', icon: <Receipt className="w-4 h-4 text-emerald-500" />, badge: 'Synced' },
            { id: 'price_schedule', label: 'Master Price Schedule', icon: <Coins className="w-4 h-4 text-amber-500" /> },
            { id: 'patient_timeline', label: 'Patient Timeline', icon: <Clock className="w-4 h-4 text-slate-500" /> }
          ]
        };

       case 'clinical':
         return {
            title: 'Clinical Care & Triage',
            items: [
              { id: 'clinical_dashboard', label: 'Clinical Dashboard', icon: <LayoutGrid className="w-4 h-4 text-emerald-500" /> },
              { id: 'consultations', label: 'Physician Consultation', icon: <Stethoscope className="w-4 h-4 text-rose-500" />, hasSubmenu: true, subItems: [
               { id: 'consultations_all', label: 'All Patients', icon: <Users className="w-4 h-4 text-blue-500" /> },
               { id: 'consultations_awaiting', label: 'Awaiting', icon: <Clock className="w-4 h-4 text-amber-500" /> },
               { id: 'consultations_consulted', label: 'Consulted', icon: <UserCheck className="w-4 h-4 text-emerald-500" /> },
               { id: 'consultations_incoming', label: 'Incoming', icon: <Bell className="w-4 h-4 text-purple-500" /> },
             ]},
              { id: 'nursing_station', label: 'Nursing Station & Triage', icon: <Activity className="w-4 h-4 text-teal-500" />, hasSubmenu: true, subItems: [
                { id: 'nursing_all', label: 'All Patients', icon: <Users className="w-4 h-4 text-blue-500" /> },
                { id: 'nursing_awaiting', label: 'Awaiting', icon: <Clock className="w-4 h-4 text-amber-500" /> },
                { id: 'nursing_consulting', label: 'Consulting', icon: <UserCheck className="w-4 h-4 text-emerald-500" /> },
                { id: 'nursing_with_doctor', label: 'With Doctor', icon: <Stethoscope className="w-4 h-4 text-violet-500" /> },
                { id: 'nursing_incoming', label: 'Incoming', icon: <Bell className="w-4 h-4 text-purple-500" /> },
              ]},
             { id: 'lab_alerts', label: 'Diagnostic Alerts', icon: <TestTube className="w-4 h-4 text-amber-500" /> },
              { id: 'nursing_consumables', label: 'Nursing Consumables', icon: <Package className="w-4 h-4 text-teal-500" /> }
           ]
         };

      case 'laboratory':
        return {
          title: 'Diagnostic Laboratory',
          items: [
            { id: 'lab_overview', label: 'Overview', icon: <TrendingUp className="w-4 h-4 text-emerald-500" />, badge: 'Live' },
            { id: 'lab_all', label: 'All Department', icon: <Inbox className="w-4 h-4 text-blue-500" /> },
            { id: 'hematology', label: 'Hematology', icon: <TestTube className="w-4 h-4 text-rose-500" /> },
            { id: 'chemical_pathology', label: 'Chem Pathology', icon: <Dna className="w-4 h-4 text-teal-500" /> },
            { id: 'microbiology', label: 'Microbiology', icon: <Bug className="w-4 h-4 text-amber-500" /> },
            { id: 'histopathology', label: 'Histopathology', icon: <Microscope className="w-4 h-4 text-purple-500" /> },
            { id: 'molecular', label: 'Molecular', icon: <Dna className="w-4 h-4 text-indigo-500" /> },
            { id: 'lab_stock', label: 'Stock', icon: <Boxes className="w-4 h-4 text-cyan-500" /> },
            { id: 'lab_inventory', label: 'Test Inventory', icon: <FileSpreadsheet className="w-4 h-4 text-indigo-500" /> }
          ]
        };

      case 'pharmacy':
        return {
          title: 'Pharmacy & Therapeutics',
          items: [
            { id: 'pharmacy_overview', label: 'Overview', icon: <TrendingUp className="w-4 h-4 text-purple-500" />, badge: 'Stats' },
            { id: 'rx_queue', label: 'Prescription Queue', icon: <Inbox className="w-4 h-4 text-emerald-500" />, badge: 'Orders' },
            { id: 'dispensed', label: 'Dispensed', icon: <CheckCircle2 className="w-4 h-4 text-teal-500" /> },
            { id: 'pharmacy_inventory', label: 'Medication Inventory', icon: <Coins className="w-4 h-4 text-amber-500" /> },
            { id: 'pharmacy_consumables', label: 'Pharmacy Consumables', icon: <Boxes className="w-4 h-4 text-teal-500" /> },
            { id: 'pharmacy_stock_requests', label: 'Stock Requests', icon: <Package className="w-4 h-4 text-blue-500" /> }
          ]
        };

      case 'radiology':
        return {
          title: 'Radiology & Medical Imaging',
          items: [
            { id: 'radiology_overview', label: 'Overview', icon: <TrendingUp className="w-4 h-4 text-indigo-500" />, badge: 'Live' },
            { id: 'radiology_all', label: 'All Scan Orders', icon: <Radio className="w-4 h-4 text-blue-500" /> },
            { id: 'xray', label: 'Digital X-Ray', icon: <FileCheck2 className="w-4 h-4 text-cyan-500" /> },
            { id: 'ultrasound', label: 'Ultrasound Scan (USS)', icon: <Activity className="w-4 h-4 text-teal-500" /> },
            { id: 'ct_scan', label: 'CT Scan', icon: <Microscope className="w-4 h-4 text-amber-500" /> },
            { id: 'mri', label: 'Magnetic Resonance (MRI)', icon: <Dna className="w-4 h-4 text-purple-500" /> },
            { id: 'radiology_reports', label: 'Completed PACS Reports', icon: <FileSpreadsheet className="w-4 h-4 text-emerald-500" /> },
            { id: 'radiology_stock', label: 'Imaging Consumables', icon: <Boxes className="w-4 h-4 text-blue-500" /> },
            { id: 'radiology_pricing', label: 'Tariff & Scan Directory', icon: <Coins className="w-4 h-4 text-indigo-500" /> }
          ]
        };

      case 'physiotherapy':
        return {
          title: 'Physiotherapy & Rehabilitation',
          items: [
            { id: 'physio_overview', label: 'Overview', icon: <TrendingUp className="w-4 h-4 text-teal-500" />, badge: 'Live' },
            { id: 'physio_all', label: 'All Therapy Orders', icon: <Activity className="w-4 h-4 text-rose-500" /> },
            { id: 'musculoskeletal', label: 'Musculoskeletal & Ortho', icon: <Sparkles className="w-4 h-4 text-blue-500" /> },
            { id: 'neuro_rehab', label: 'Neurological Rehab', icon: <Dna className="w-4 h-4 text-purple-500" /> },
            { id: 'sports_physio', label: 'Sports Injury Therapy', icon: <TrendingUp className="w-4 h-4 text-amber-500" /> },
            { id: 'pediatric_physio', label: 'Pediatric Physical Care', icon: <Users className="w-4 h-4 text-emerald-500" /> },
            { id: 'physio_sessions', label: 'Ongoing Therapy Sessions', icon: <Clock className="w-4 h-4 text-teal-500" /> },
            { id: 'physio_equipment', label: 'Rehab Supplies & Equipment', icon: <Boxes className="w-4 h-4 text-indigo-500" /> },
            { id: 'physio_pricing', label: 'Session Tariffs', icon: <Coins className="w-4 h-4 text-emerald-500" /> }
          ]
        };

      case 'billing':
        return {
          title: 'Central Billing & Cashier',
          items: [
            { id: 'all_invoices', label: 'All Invoices', icon: <Receipt className="w-4 h-4 text-blue-500" /> },
            { id: 'process_payment', label: 'Receive Payment / Cashier', icon: <CreditCard className="w-4 h-4 text-emerald-500" /> },
            { id: 'price_schedule', label: 'Master Price Schedule', icon: <Coins className="w-4 h-4 text-teal-500" /> }
          ]
        };

      case 'analytics':
        return {
          title: 'Clinical Analytics',
          items: [
            { id: 'patient_stats', label: 'Patient Statistics', icon: <TrendingUp className="w-4 h-4 text-blue-500" /> },
            { id: 'lab_stats', label: 'Laboratory Workload', icon: <PieChart className="w-4 h-4 text-amber-500" /> },
            { id: 'financial_stats', label: 'Revenue Analytics', icon: <DollarSign className="w-4 h-4 text-emerald-500" /> }
          ]
        };

      case 'ai':
        return {
          title: 'Clinical AI Assistant',
          items: [
            { id: 'nl_query', label: 'Natural Language Query', icon: <Sparkles className="w-4 h-4 text-fuchsia-500" /> },
            { id: 'ai_summarizer', label: 'Patient Summarizer', icon: <Bot className="w-4 h-4 text-purple-500" /> },
            { id: 'ai_safety', label: 'Clinical AI Safeguards', icon: <ShieldCheck className="w-4 h-4 text-emerald-500" /> }
          ]
        };

      case 'admin':
        return {
          title: 'System Administration',
          items: [
            { id: 'users_mgmt', label: 'Staff Accounts & Roles', icon: <UserCog className="w-4 h-4 text-blue-500" /> },
            { id: 'consumables_mgmt', label: 'Clinical Consumables', icon: <Boxes className="w-4 h-4 text-emerald-500" /> },
            { id: 'lab_mgmt', label: 'Laboratory Investigations', icon: <TestTube className="w-4 h-4 text-rose-500" /> },
            { id: 'pharmacy_mgmt', label: 'Pharmacy Formulary & Stocks', icon: <Package className="w-4 h-4 text-purple-500" /> },
            { id: 'radiology_physio_mgmt', label: 'Radiology & Physio Tariffs', icon: <Radio className="w-4 h-4 text-indigo-500" /> },
            { id: 'pricing_config', label: 'Master Pricing Matrix', icon: <Sliders className="w-4 h-4 text-teal-500" /> },
            { id: 'receipt_settings', label: 'Receipt Settings', icon: <Receipt className="w-4 h-4 text-cyan-500" /> },
            { id: 'system_settings', label: 'Hospital Parameters', icon: <Building className="w-4 h-4 text-slate-500" /> }
          ]
        };

      default:
        return { title: 'Navigation', items: [] };
    }
  };

  const { title, items } = getSubMenuItems(activeNav);

  return (
    <aside className="w-[20%] h-full overflow-y-auto px-3 py-4 select-text bg-white dark:bg-dark-card border-r border-light-border/60 dark:border-dark-border/60 transition-colors">
      <div className="px-3 pb-2.5 border-b border-light-border/50 dark:border-dark-border/50 mb-3">
        <h2 className="text-xs font-black tracking-wide uppercase text-emerald-600 dark:text-emerald-400 truncate">
          {title}
        </h2>
      </div>

      <div className="flex flex-col space-y-1.5">
        {items.map(item => {
          const isActive = activeSubNav === item.id;
          const isExpanded = expandedId === item.id;
          const isParentActive = item.hasSubmenu && item.subItems?.some(s => s.id === activeSubNav);

          if (item.hasSubmenu && item.subItems) {
            return (
              <div key={item.id}>
                <button
                  onClick={() => toggleExpand(item.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center justify-between transition-all duration-150 ${
                    isActive || isParentActive
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-bold border border-emerald-200 dark:border-emerald-800/60 shadow-sm'
                      : 'hover:bg-slate-50 dark:hover:bg-dark-surface/60 text-slate-700 dark:text-slate-300 font-semibold border border-transparent'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <div className={`p-1.5 rounded-lg flex-shrink-0 ${
                      isActive || isParentActive
                        ? 'bg-white dark:bg-dark-card shadow-sm' 
                        : 'bg-slate-100 dark:bg-dark-surface'
                    }`}>
                      {item.icon}
                    </div>
                    <span className="text-xs truncate">{item.label}</span>
                  </div>
                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                </button>
                {isExpanded && (
                  <div className="ml-4 mt-1 space-y-0.5 border-l-2 border-slate-200 dark:border-dark-border pl-2">
                    {item.subItems!.map(sub => {
                      const subActive = sub.id === activeSubNav;
                      return (
                        <button
                          key={sub.id}
                          onClick={() => { onSelectSubNav(sub.id); if (expandedId !== item.id) setExpandedId(item.id); }}
                          className={`w-full text-left px-3 py-2 rounded-lg text-[11px] font-bold transition-all ${
                            subActive
                              ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40'
                              : 'hover:bg-slate-50 dark:hover:bg-dark-surface/40 text-slate-500 dark:text-slate-400 border border-transparent'
                          }`}
                        >
                          <div className="flex items-center space-x-2">
                            {sub.icon}
                            <span>{sub.label}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          return (
            <button
              key={item.id}
              onClick={() => { onSelectSubNav(item.id); }}
              className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center justify-between transition-all duration-150 ${
                isActive
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-bold border border-emerald-200 dark:border-emerald-800/60 shadow-sm'
                  : 'hover:bg-slate-50 dark:hover:bg-dark-surface/60 text-slate-700 dark:text-slate-300 font-semibold border border-transparent'
              }`}
            >
              <div className="flex items-center space-x-2.5 min-w-0">
                <div className={`p-1.5 rounded-lg flex-shrink-0 ${
                  isActive 
                    ? 'bg-white dark:bg-dark-card shadow-sm' 
                    : 'bg-slate-100 dark:bg-dark-surface'
                }`}>
                  {item.icon}
                </div>
                <span className="text-xs truncate">{item.label}</span>
              </div>

              {item.badge && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                  isActive 
                    ? 'bg-emerald-200 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-100'
                    : 'bg-slate-100 dark:bg-dark-surface text-slate-500 dark:text-slate-400'
                }`}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
};
