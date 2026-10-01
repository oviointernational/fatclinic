import React, { useState } from 'react';
import { ChevronUp, ChevronDown, ShieldAlert } from 'lucide-react';
import { useAccess } from '../../hooks/useAccess';
import { SUB_NAV, type MainNavId, type SubNavId, type SubNavItem } from './navModel';
import { navIcon } from './navIcons';

export type { MainNavId, SubNavId };

interface Sidebar2Props {
  activeNav: MainNavId;
  activeSubNav: SubNavId;
  onSelectSubNav: (id: SubNavId) => void;
  /** Fixed widths in drawer mode; a 20% slice of a phone is unreadable. */
  asDrawer?: boolean;
}

export const Sidebar2: React.FC<Sidebar2Props> = ({
  activeNav,
  activeSubNav,
  onSelectSubNav,
  asDrawer = false,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const access = useAccess();

  const group = SUB_NAV[activeNav];
  const items = access.permittedSubNavs(activeNav);

  // A destination the person may not open is not rendered at all, and the whole
  // bar says why it is empty rather than showing an empty column.
  if (!group || items.length === 0) {
    return (
      <aside className={`${asDrawer ? 'w-[190px] min-w-[190px]' : 'w-[20%]'} h-full overflow-y-auto px-3 py-4 select-text bg-white dark:bg-dark-card border-r border-light-border/60 dark:border-dark-border/60`}>
        <div className="flex flex-col items-center justify-center h-full text-center gap-2 px-2">
          <ShieldAlert className="w-5 h-5 text-slate-300 dark:text-slate-600" />
          <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
            No screens in this section are assigned to your account.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={`${asDrawer ? 'w-[190px] min-w-[190px]' : 'w-[20%]'} h-full overflow-y-auto px-3 py-4 select-text bg-white dark:bg-dark-card border-r border-light-border/60 dark:border-dark-border/60 transition-colors`}
    >
      <div className="px-3 pb-2.5 border-b border-light-border/50 dark:border-dark-border/50 mb-3">
        <h2 className="text-xs font-black tracking-wide uppercase text-emerald-600 dark:text-emerald-400 truncate">
          {group.title}
        </h2>
      </div>

      <div className="flex flex-col space-y-1.5">
        {items.map(item => (
          <Item
            key={item.id}
            item={item}
            activeSubNav={activeSubNav}
            expandedId={expandedId}
            onToggle={() => setExpandedId(prev => prev === item.id ? null : item.id)}
            onSelect={(id) => { onSelectSubNav(id); setExpandedId(item.id); }}
          />
        ))}
      </div>
    </aside>
  );
};

const Item: React.FC<{
  item: SubNavItem;
  activeSubNav: SubNavId;
  expandedId: string | null;
  onToggle: () => void;
  onSelect: (id: SubNavId) => void;
}> = ({ item, activeSubNav, expandedId, onToggle, onSelect }) => {
  const isActive = activeSubNav === item.id;
  const isExpanded = expandedId === item.id;
  const isParentActive = !!item.subItems?.some(s => s.id === activeSubNav);
  const Icon = navIcon(item.icon);

  if (item.subItems?.length) {
    return (
      <div>
        <button
          onClick={onToggle}
          className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center justify-between transition-all duration-150 ${
            isActive || isParentActive
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-bold border border-emerald-200 dark:border-emerald-800/60 shadow-sm'
              : 'hover:bg-slate-50 dark:hover:bg-dark-surface/60 text-slate-700 dark:text-slate-300 font-semibold border border-transparent'
          }`}
        >
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className={`p-1.5 rounded-lg flex-shrink-0 ${
              isActive || isParentActive ? 'bg-white dark:bg-dark-card shadow-sm' : 'bg-slate-100 dark:bg-dark-surface'
            }`}>
              <Icon className="w-4 h-4" />
            </div>
            <span className="text-xs truncate">{item.label}</span>
          </div>
          {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
        </button>
        {isExpanded && (
          <div className="ml-4 mt-1 space-y-0.5 border-l-2 border-slate-200 dark:border-dark-border pl-2">
            {item.subItems.map(sub => {
              const SubIcon = navIcon(sub.icon);
              const subActive = sub.id === activeSubNav;
              return (
                <button
                  key={sub.id}
                  onClick={() => onSelect(sub.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-[11px] font-bold transition-all ${
                    subActive
                      ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40'
                      : 'hover:bg-slate-50 dark:hover:bg-dark-surface/40 text-slate-500 dark:text-slate-400 border border-transparent'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <SubIcon className="w-4 h-4" />
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
      onClick={() => onSelect(item.id)}
      aria-current={isActive ? 'page' : undefined}
      className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center justify-between transition-all duration-150 ${
        isActive
          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-bold border border-emerald-200 dark:border-emerald-800/60 shadow-sm'
          : 'hover:bg-slate-50 dark:hover:bg-dark-surface/60 text-slate-700 dark:text-slate-300 font-semibold border border-transparent'
      }`}
    >
      <div className="flex items-center space-x-2.5 min-w-0">
        <div className={`p-1.5 rounded-lg flex-shrink-0 ${
          isActive ? 'bg-white dark:bg-dark-card shadow-sm' : 'bg-slate-100 dark:bg-dark-surface'
        }`}>
          <Icon className="w-4 h-4" />
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
};