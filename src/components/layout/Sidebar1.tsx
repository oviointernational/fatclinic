import React, { useState } from 'react';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { useCurrentUser } from '../../context/AuthContext';
import { useAccess } from '../../hooks/useAccess';
import { MAIN_NAV, type MainNavId } from './navModel';
import { navIcon } from './navIcons';

export type { MainNavId };

interface Sidebar1Props {
  activeNav: MainNavId;
  onSelectNav: (id: MainNavId) => void;
  /**
   * Rendered as an overlay drawer on a phone rather than as a column.
   *
   * Widths are fixed for the same reason as the submenu's, and in the drawer both
   * columns add up to 264px, which leaves a phone-width screen with something to
   * tap outside of. It starts expanded because an icon-only rail on a phone is a
   * guessing game.
   */
  asDrawer?: boolean;
}

export const Sidebar1: React.FC<Sidebar1Props> = ({ activeNav, onSelectNav, asDrawer = false }) => {
  const currentUser = useCurrentUser();
  const access = useAccess();
  const [collapsedByHand, setCollapsedByHand] = useState(false);

  const items = access.permittedMainNavs();
  const isExpanded = !collapsedByHand;

  if (items.length === 0) {
    return (
      <aside className="h-full overflow-y-auto py-4 flex flex-col items-center select-text bg-light-bg dark:bg-dark-bg border-r border-light-border/40 dark:border-dark-border/40">
        <p className="text-[10px] text-slate-400 px-3 text-center leading-relaxed">
          No sections are assigned to this account. Ask an administrator to grant access under
          Roles &amp; Permissions.
        </p>
      </aside>
    );
  }

  return (
    <aside
      className={`${
        isExpanded
          ? asDrawer ? 'w-[168px]' : 'w-[200px]'
          : asDrawer ? 'w-[64px]' : 'w-[76px]'
      } flex-shrink-0 h-full overflow-y-auto py-4 flex flex-col items-center select-text bg-light-bg dark:bg-dark-bg border-r border-light-border/40 dark:border-dark-border/40 transition-all duration-300`}
    >
      <nav className={`w-full flex flex-col ${isExpanded ? 'items-start px-3' : 'items-center px-2'} space-y-2`}>
        {items.map(item => {
          const isActive = activeNav === item.id;
          const Icon = navIcon(item.icon);

          return (
            <button
              key={item.id}
              onClick={() => onSelectNav(item.id)}
              title={item.label}
              aria-current={isActive ? 'page' : undefined}
              className={`group relative w-full flex items-center ${
                isExpanded ? 'space-x-2.5 px-2 py-2 rounded-xl' : 'justify-center p-2 rounded-2xl'
              } transition-all duration-200 ${
                isActive
                  ? 'bg-white dark:bg-dark-card shadow-md'
                  : 'hover:bg-slate-200/40 dark:hover:bg-dark-surface/50'
              }`}
            >
              <div className="relative flex-shrink-0">
                <div
                  className={`w-11 h-11 rounded-full bg-gradient-to-tr ${item.color} flex items-center justify-center shadow-md transition-transform duration-200 ${
                    isActive
                      ? 'ring-2 ring-emerald-400 ring-offset-2 dark:ring-offset-dark-card'
                      : 'group-hover:scale-105'
                  }`}
                >
                  <Icon className="w-5 h-5 text-white" />
                </div>

                {isActive && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                  </span>
                )}
              </div>

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
          onClick={() => setCollapsedByHand(!collapsedByHand)}
          title={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
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
      {currentUser && (
        <div
          className="mt-auto pt-4 flex flex-col items-center text-[10px] text-slate-400 dark:text-slate-600 border-t border-light-border/40 dark:border-dark-border/40 w-full px-1 text-center"
          title={`${currentUser.name} (${currentUser.department})`}
        >
          <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-dark-card flex items-center justify-center text-[10px] font-black text-slate-600 dark:text-slate-300 flex-shrink-0">
            {currentUser.name.charAt(0)}
          </div>
        </div>
      )}
    </aside>
  );
};