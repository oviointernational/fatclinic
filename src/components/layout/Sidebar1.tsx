import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  Users, 
  Stethoscope, 
  FlaskConical, 
  Pill,
  Bot,
  Settings,
  ChevronRight,
  ChevronLeft,
  Radio,
  Activity
} from 'lucide-react';
import { useCurrentUser } from '../../context/AuthContext';
import { MainNavId } from '../../types';

export type { MainNavId };

interface MenuItem {
  id: MainNavId;
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  roles?: string[];
  color: string;
}

interface Sidebar1Props {
  activeNav: MainNavId;
  onSelectNav: (id: MainNavId) => void;
}

export const Sidebar1: React.FC<Sidebar1Props> = ({ activeNav, onSelectNav }) => {
  const currentUser = useCurrentUser();
  const [isExpanded, setIsExpanded] = useState(false);

  const menuItems: MenuItem[] = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      sublabel: 'Workstation overview',
      icon: <LayoutDashboard className="w-5 h-5 text-white" />,
      color: 'from-emerald-500 to-teal-600'
    },
    {
      id: 'patients',
      label: 'Front Desk',
      sublabel: 'Reception & Cashier',
      icon: <Users className="w-5 h-5 text-white" />,
      color: 'from-blue-500 to-indigo-600'
    },
    {
      id: 'clinical',
      label: 'Clinical',
      sublabel: 'Consultation & Nursing',
      icon: <Stethoscope className="w-5 h-5 text-white" />,
      color: 'from-rose-500 to-pink-600'
    },
    {
      id: 'laboratory',
      label: 'Laboratory',
      sublabel: '4 Pathology Fields',
      icon: <FlaskConical className="w-5 h-5 text-white" />,
      color: 'from-amber-500 to-orange-600'
    },
    {
      id: 'pharmacy',
      label: 'Pharmacy',
      sublabel: 'Prescription & Drugs',
      icon: <Pill className="w-5 h-5 text-white" />,
      color: 'from-purple-500 to-violet-600'
    },
    {
      id: 'radiology',
      label: 'Radiology',
      sublabel: 'Imaging & Scans',
      icon: <Radio className="w-5 h-5 text-white" />,
      color: 'from-indigo-600 to-blue-700'
    },
    {
      id: 'physiotherapy',
      label: 'Physiotherapy',
      sublabel: 'Rehab & Therapy',
      icon: <Activity className="w-5 h-5 text-white" />,
      color: 'from-teal-600 to-emerald-700'
    },
    {
      id: 'ai',
      label: 'AI Assistant',
      sublabel: 'Query & Summaries',
      icon: <Bot className="w-5 h-5 text-white" />,
      color: 'from-fuchsia-500 to-pink-600'
    },
    {
      id: 'admin',
      label: 'Administration',
      sublabel: 'Users & Setup',
      icon: <Settings className="w-5 h-5 text-white" />,
      color: 'from-slate-600 to-slate-800'
    }
  ];

  return (
    <aside
      className={`${
        isExpanded ? 'w-[200px] min-w-[200px]' : 'w-[10%] min-w-[70px] max-w-[100px]'
      } h-full overflow-y-auto py-4 flex flex-col items-center select-text bg-light-bg dark:bg-dark-bg border-r border-light-border/40 dark:border-dark-border/40 transition-all duration-300`}
    >
      <nav className={`w-full flex flex-col ${isExpanded ? 'items-start px-3' : 'items-center px-2'} space-y-2`}>
        {menuItems.map(item => {
          const isActive = activeNav === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onSelectNav(item.id)}
              title={item.label}
              className={`group relative w-full flex items-center ${
                isExpanded ? 'space-x-2.5 px-2 py-2 rounded-xl' : 'justify-center p-2 rounded-2xl'
              } transition-all duration-200 ${
                isActive
                  ? 'bg-white dark:bg-dark-card shadow-md'
                  : 'hover:bg-slate-200/40 dark:hover:bg-dark-surface/50'
              }`}
            >
              {/* Circular Icon */}
              <div className="relative flex-shrink-0">
                <div
                  className={`w-11 h-11 rounded-full bg-gradient-to-tr ${item.color} flex items-center justify-center shadow-md transition-transform duration-200 ${
                    isActive
                      ? 'ring-2 ring-emerald-400 ring-offset-2 dark:ring-offset-dark-card'
                      : 'group-hover:scale-105'
                  }`}
                >
                  {item.icon}
                </div>

                {/* Pulsating Indicator Dot for Active item */}
                {isActive && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                  </span>
                )}
              </div>

              {/* Label (only when expanded) */}
              {isExpanded && (
                <div className="flex flex-col items-start min-w-0">
                  <span className={`text-xs font-bold truncate ${
                    isActive ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'
                  }`}>{item.label}</span>
                  <span className="text-[10px] text-slate-400 truncate leading-tight">{item.sublabel}</span>
                </div>
              )}
            </button>
          );
        })}

        {/* Expand / Collapse Toggle */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          title={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          className={`w-full flex items-center ${
            isExpanded ? 'justify-end px-3 py-2' : 'justify-center p-2'
          } text-slate-400 hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors rounded-xl hover:bg-slate-100 dark:hover:bg-dark-surface mt-1`}
        >
          {isExpanded
            ? <ChevronLeft className="w-4 h-4" />
            : <ChevronRight className="w-4 h-4" />
          }
        </button>
      </nav>

      {/* Station Avatar Footer */}
      <div
        className="mt-auto pt-4 flex flex-col items-center text-[10px] text-slate-400 dark:text-slate-600 border-t border-light-border/40 dark:border-dark-border/40 w-full px-1 text-center"
        title={`${currentUser.name} (${currentUser.department})`}
      >
        <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-dark-surface flex items-center justify-center text-sm shadow-inner font-bold">
          {currentUser.avatar || '👨‍⚕️'}
        </div>
      </div>
    </aside>
  );
};
