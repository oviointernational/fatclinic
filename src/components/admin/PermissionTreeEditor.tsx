import React, { useState } from 'react';
import { ChevronDown, ChevronRight, MinusSquare } from 'lucide-react';
import {
  PermissionNode,
  PERMISSION_TREE,
  directChildren,
  isEffectivelyGranted,
  togglePermission,
  countGranted,
  totalPermissionCount,
} from '../../services/permissions';

interface PermissionTreeEditorProps {
  selected: string[];
  onChange: (next: string[]) => void;
}

const Row: React.FC<{
  node: PermissionNode;
  selected: string[];
  onToggle: (key: string) => void;
  depth: number;
}> = ({ node, selected, onToggle, depth }) => {
  const [open, setOpen] = useState(depth < 1);
  const hasKids = !!node.children?.length;
  const checked = isEffectivelyGranted(selected, node.key);
  const kids = directChildren(node.key);
  const someChild = hasKids && kids.some(k => isEffectivelyGranted(selected, k));
  const indeterminate = hasKids && !checked && someChild;

  return (
    <div>
      <div
        className={`flex items-center space-x-2 px-2 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-surface ${
          depth === 0 ? 'bg-slate-50 dark:bg-dark-surface/60 font-extrabold' : ''
        }`}
        style={{ marginLeft: depth * 18 }}
      >
        {hasKids ? (
          <button type="button" onClick={() => setOpen(o => !o)} className="p-0.5 rounded text-slate-400 hover:text-slate-600">
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <button
          type="button"
          onClick={() => onToggle(node.key)}
          className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-all ${
            checked
              ? 'bg-indigo-600 border-indigo-600 text-white'
              : indeterminate
              ? 'bg-indigo-100 border-indigo-400 text-indigo-600'
              : 'bg-white border-slate-300 hover:border-indigo-400'
          }`}
          title={checked ? 'Granted — click to revoke' : 'Not granted — click to grant'}
        >
          {checked && <span className="text-[10px] leading-none font-black">✓</span>}
          {indeterminate && <MinusSquare className="w-3 h-3" />}
        </button>
        <button type="button" onClick={() => (hasKids ? setOpen(o => !o) : onToggle(node.key))} className="text-left flex-1 min-w-0">
          <span className={`text-xs ${depth === 0 ? 'font-extrabold text-slate-900 dark:text-white' : depth === 1 ? 'font-bold text-slate-700 dark:text-slate-200' : 'text-slate-600 dark:text-slate-300'}`}>
            {node.label}
          </span>
          {node.hint && <span className="block text-[10px] text-slate-400 font-normal">{node.hint}</span>}
        </button>
      </div>
      {hasKids && open && (
        <div>
          {node.children!.map(child => (
            <Row key={child.key} node={child} selected={selected} onToggle={onToggle} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export const PermissionTreeEditor: React.FC<PermissionTreeEditorProps> = ({ selected, onChange }) => {
  const [filter, setFilter] = useState('');
  const granted = countGranted(selected);
  const total = totalPermissionCount();

  const filteredTree: PermissionNode[] = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return PERMISSION_TREE;
    const match = (n: PermissionNode): PermissionNode | null => {
      const self = n.label.toLowerCase().includes(q) || n.key.toLowerCase().includes(q);
      const kids = (n.children || []).map(match).filter(Boolean) as PermissionNode[];
      if (self) return n;
      if (kids.length) return { ...n, children: kids };
      return null;
    };
    return PERMISSION_TREE.map(match).filter(Boolean) as PermissionNode[];
  }, [filter]);

  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 dark:bg-dark-surface border-b flex items-center justify-between gap-2">
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter permissions (e.g. histopathology, result...)"
          className="flex-1 px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-dark-card border focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">{granted}/{total} granted</span>
      </div>
      <div className="p-2 space-y-0.5 max-h-72 overflow-y-auto">
        {filteredTree.map(node => (
          <Row key={node.key} node={node} selected={selected} onToggle={key => onChange(togglePermission(selected, key))} depth={0} />
        ))}
        {filteredTree.length === 0 && <div className="text-center text-xs text-slate-400 py-4">No permissions match.</div>}
      </div>
      <div className="px-3 py-1.5 bg-slate-50 dark:bg-dark-surface border-t text-[10px] text-slate-500">
        Tick a module (e.g. Laboratory) for everything inside it. Unticking one leaf (e.g. Enter result) keeps the rest.
      </div>
    </div>
  );
};
