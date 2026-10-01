import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import {
  filterAndRank, matchSpan, type TypeaheadOption,
} from '../../services/searchRank';

export type { TypeaheadOption };

/**
 * A search box that completes as you type.
 *
 * WHY THIS EXISTS
 * ---------------
 * The two places it is used - picking a medication and picking a laboratory
 * investigation - were `<select>` elements listing every option. A clinic
 * formulary is several hundred items and an investigation catalogue is dozens;
 * a native dropdown gives you a scrollbar and no search, so finding
 * "Co-amoxiclav" means scrolling past everything before it, and finding the
 * right one of three similarly-named strengths is guesswork. Both lists are also
 * re-rendered on every keystroke in some flows, which a filtered list avoids.
 *
 * WHAT "AUTOCOMPLETE" IS NOT DOING HERE
 * ------------------------------------
 * It does not rewrite what was typed. A clinical system that silently changes
 * "amoxycillin" into a different drug, or corrects a patient's name to a
 * different patient, can misbill a medication or attach a report to the wrong
 * person. It suggests; the person chooses. The only text this component alters
 * is the query itself, and only to compare it - what lands in the field is
 * always an option that was really in the list.
 *
 * A mistyped name that matches nothing shows "no matches" and names the thing
 * being searched, rather than silently leaving an empty field that looks
 * selected.
 */

export interface TypeaheadProps {
  options: TypeaheadOption[];
  /** The chosen value, or null. The field itself is never the source of truth. */
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  /** What is being searched for, used in the "no matches" sentence. */
  searchingFor?: string;
  inputClassName?: string;
  className?: string;
  disabled?: boolean;
  /** Called when the list is dismissed, so a parent dialog can reset itself. */
  onClear?: () => void;
}

export const Typeahead: React.FC<TypeaheadProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Start typing to search',
  searchingFor = 'options',
  inputClassName = '',
  className = '',
  disabled = false,
  onClear,
}) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const matches = useMemo(() => filterAndRank(options, query), [options, query]);
  const selected = options.find(o => o.value === value) ?? null;

  // The chosen item is shown whenever there is no query, so the field reads as
  // "Amoxicillin 500mg" rather than as an empty box that has something in it.
  const displayText = isOpen ? query : (selected?.label ?? '');

  const choose = useCallback((option: TypeaheadOption | null) => {
    if (!option || option.disabled) return;
    onChange(option.value);
    setQuery('');
    setIsOpen(false);
    setActiveIndex(0);
  }, [onChange]);

  // A list that changes length must not leave the highlight pointing past the end.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Clicking anywhere else dismisses the list. Without this the list stays open
  // over whatever the person clicked next.
  useEffect(() => {
    if (!isOpen) return;
    const onAway = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onAway);
    return () => document.removeEventListener('mousedown', onAway);
  }, [isOpen]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) { setIsOpen(true); return; }
      setActiveIndex(i => Math.min(i + 1, matches.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      // Only intercept Enter while a suggestion is actually highlighted, so
      // Enter still submits the surrounding form when the field is being typed
      // into rather than picked from.
      if (isOpen && matches[activeIndex]) {
        e.preventDefault();
        choose(matches[activeIndex]);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (isOpen) { setIsOpen(false); return; }
      // A second Escape clears the chosen item, which is the only way back once
      // something has been selected and the text is no longer editable.
      if (selected) { onChange(''); onClear?.(); }
      return;
    }
    if (e.key === 'Backspace' && !query && selected) {
      onChange('');
      onClear?.();
    }
  };

  const activeId = matches[activeIndex] ? `${listId}-${activeIndex}` : undefined;

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={displayText}
          placeholder={placeholder}
          onChange={(e) => { setQuery(e.target.value); setIsOpen(true); }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={onKeyDown}
          className={`w-full pl-9 pr-9 py-2 rounded-xl border border-light-border dark:border-dark-border bg-white dark:bg-dark-card text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 disabled:opacity-50 ${inputClassName}`}
        />
        {(query || selected) && (
          <button
            type="button"
            aria-label="Clear"
            onClick={() => { setQuery(''); onChange(''); onClear?.(); inputRef.current?.focus(); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <ChevronDown className="w-4 h-4 text-slate-400 absolute right-8 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>

      {isOpen && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-xl border border-light-border dark:border-dark-border bg-white dark:bg-dark-card shadow-xl py-1"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-3 text-xs text-slate-400">
              Nothing matches “{query}” among {options.length} {searchingFor}. Check the spelling, or
              clear the box to see all of them.
            </li>
          ) : (
            matches.map((option, index) => {
              const span = matchSpan(option.label, query);
              const isActive = index === activeIndex;
              return (
                <li key={option.value} role="option" aria-selected={isActive}>
                  <button
                    type="button"
                    id={`${listId}-${index}`}
                    disabled={option.disabled}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(option)}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-3 transition-colors ${
                      isActive ? 'bg-emerald-50 dark:bg-emerald-950/40' : ''
                    } ${option.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    <span className="min-w-0 truncate text-slate-800 dark:text-slate-100">
                      {span ? (
                        <>
                          {span.before}
                          <mark className="bg-emerald-200 dark:bg-emerald-800/60 text-slate-900 dark:text-emerald-50 rounded-sm px-0.5">
                            {span.hit}
                          </mark>
                          {span.after}
                        </>
                      ) : option.label}
                    </span>
                    {option.secondary && (
                      <span className="text-[10px] text-slate-400 flex-shrink-0">{option.secondary}</span>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
};
