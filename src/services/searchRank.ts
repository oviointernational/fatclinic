/**
 * Ranking what someone typed against a list, with no interface attached.
 *
 * WHY THIS IS NOT IN THE COMPONENT
 * --------------------------------
 * `Typeahead.tsx` is JSX and imports an icon library, so a plain Node script
 * cannot load it. But "which of these 400 medicines did they most likely mean"
 * is a rule, not a rendering, and a rule that cannot be tested is a rule that
 * will be changed until it is wrong. So the rules live here and the component
 * draws the result.
 *
 * WHY RANKING AT ALL
 * ------------------
 * Filtering alone is not enough once a list is long. Typing "cillin" should put
 * Amoxicillin above Erythromycin, and a person who typed a fragment of a name
 * wants the medicine whose name *starts* with what they typed, not the twenty
 * that contain it somewhere. The ranks below are deliberately coarse: prefix,
 * then word-start, then anywhere. A finer score would be harder to explain when
 * it puts something surprising on top, and "why did that come first" has to have
 * an answer a person can act on.
 */

export interface TypeaheadOption {
  value: string;
  label: string;
  /** Right-hand detail: strength, price, sample type, stock count. */
  secondary?: string;
  disabled?: boolean;
}

/** Lower is better. `null` means "does not match at all". */
export const MATCH_PREFIX = 1;
export const MATCH_WORD_START = 2;
export const MATCH_ANYWHERE = 3;
export const MATCH_SECONDARY = 3;

export function rankMatch(option: TypeaheadOption, query: string): number | null {
  if (!query) return 0;

  const needle = query.trim().toLowerCase();
  if (!needle) return 0;

  const haystack = option.label.toLowerCase();
  const at = haystack.indexOf(needle);

  if (at < 0) {
    // Also match the right-hand detail, so typing a strength ("500mg") or a stock
    // figure finds the medicine. Knowing the strength and not the brand name is
    // a normal way to search a formulary.
    if (option.secondary && option.secondary.toLowerCase().includes(needle)) return MATCH_SECONDARY;
    return null;
  }

  if (at === 0) return MATCH_PREFIX;

  // A match beginning a word is nearly always the intended one: "para" should
  // reach Paracetamol before it reaches anything containing those letters.
  const before = haystack[at - 1];
  if (before === ' ' || before === '-' || before === '(' || before === ',') return MATCH_WORD_START;

  return MATCH_ANYWHERE;
}

export interface RankedOption extends TypeaheadOption {
  rank: number;
  /** Where the match starts, used only to break ties. */
  at: number;
}

/**
 * The options that match, best first.
 *
 * `limit` exists because the longest list in the application is the medication
 * formulary: rendering every match into the DOM on each keystroke is what makes a
 * search box feel slow, and nobody scrolls past sixty medicines.
 */
export function rankOptions(options: TypeaheadOption[], query: string): RankedOption[] {
  const needle = query.trim().toLowerCase();
  const scored: RankedOption[] = [];

  for (const option of options) {
    const rank = rankMatch(option, query);
    if (rank === null) continue;
    scored.push({
      ...option,
      rank,
      at: option.label.toLowerCase().indexOf(needle),
    });
  }

  scored.sort((a, b) => a.rank - b.rank || a.at - b.at || a.label.localeCompare(b.label));
  return scored;
}

export function filterAndRank(options: TypeaheadOption[], query: string, limit = 60): TypeaheadOption[] {
  return rankOptions(options, query).slice(0, limit).map(({ value, label, secondary, disabled }) => ({
    value, label, secondary, disabled,
  }));
}

/**
 * The three pieces of `label` either side of the match, for highlighting.
 *
 * The highlight is applied to a substring of the real label rather than to a
 * reconstructed string, so what is shown highlighted is exactly what will be
 * stored. This component never rewrites what the person typed - a clinical system
 * that silently changes a drug name or a patient name can dispense the wrong
 * thing or attach a report to the wrong person.
 */
export function matchSpan(label: string, query: string): { before: string; hit: string; after: string } | null {
  const needle = query.trim();
  if (!needle) return null;

  const at = label.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return null;

  return {
    before: label.slice(0, at),
    hit: label.slice(at, at + needle.length),
    after: label.slice(at + needle.length),
  };
}
