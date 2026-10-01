/**
 * Which stretch of time a report is about, and the rules for reading a stored
 * date against it.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Analytics screen had a date selector with four buttons - Today, This week,
 * This month, This year - and it changed nothing. Every figure on the screen was
 * computed over all records ever saved, and the label in the corner said "This
 * month" while the numbers beside it were all-time. A filter that does not filter
 * is worse than no filter: somebody decides the clinic earned less this month,
 * or that a department's workload collapsed, and acts on it.
 *
 * So the window is built here, once, and every figure is filtered through it.
 *
 * DAY BOUNDARIES ARE THE WHOLE PROBLEM
 * ------------------------------------
 * Two mistakes are available and both produce silently wrong totals.
 *
 * A record dated `2026-10-01` is compared against a window ending at
 * `2026-10-01T00:00`, so "Today" excludes today unless midnight happens to be
 * later than the record. And a custom range ending `2026-10-01` reads as
 * "the first of October" to a person, not "the first of October at midnight",
 * so it would drop everything that happened during the day they asked for.
 *
 * Both are handled here by making windows end at the END of the last day, in the
 * viewer's own timezone, and by treating a bare `YYYY-MM-DD` as a whole local day
 * rather than as an instant. Timezones matter because a record stored at
 * `2026-10-01T08:00` in Lagos is `2026-09-30T23:00` in London; comparing the raw
 * strings would move a morning's clinic into yesterday.
 */

export type DateRangeMode = 'today' | 'week' | 'month' | 'year' | 'custom' | 'all';

export interface DateWindow {
  /** Inclusive start, local midnight. */
  from: Date;
  /** Exclusive end: local midnight after the last day included. */
  to: Date;
  /** Wording for the screen, so the range is named rather than implied. */
  label: string;
  mode: DateRangeMode;
}

export const DATE_PRESETS: Array<{ id: Exclude<DateRangeMode, 'custom'>; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
];

/** Local midnight at the start of the day `d` falls in. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/**
 * Local midnight the day AFTER `d`, which is the exclusive end of that day.
 *
 * Daylight saving makes a day 23 or 25 hours long, so this is built by
 * constructing the next calendar date rather than by adding 86,400,000ms. Adding
 * milliseconds lands an hour either side of midnight for most of the year, and a
 * record saved at 00:30 that morning falls out of the window.
 */
function startOfNextDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
}

export interface WindowInput {
  mode: DateRangeMode;
  /** `YYYY-MM-DD`. Only read for `custom`. */
  from?: string;
  to?: string;
  /** Injected so the behaviour is testable and so "today" means the user's today. */
  now?: Date;
}

export interface WindowResult {
  /** Null means "no restriction" - every record counts. */
  window: DateWindow | null;
  /** Set when a custom range could not be used. The screen shows this verbatim. */
  error: string | null;
}

/**
 * Parse a stored date string into the instant it names, in local time.
 *
 * A bare `YYYY-MM-DD` is read as that whole local day rather than as midnight,
 * because that is what the person who typed it meant, and because clinic records
 * are stored date-only far more often than they carry a time.
 *
 * Returns null for anything unparseable. A record with an unreadable date is NOT
 * quietly included in every window and NOT quietly dropped from all of them: the
 * caller decides, and the report says how many such records it found.
 */
export function parseStoredDate(value: string | undefined | null): Date | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const built = new Date(Number(y), Number(m) - 1, Number(d));
    // Rejects 2026-02-31, which JavaScript would otherwise roll forward into March.
    if (built.getFullYear() !== Number(y) || built.getMonth() !== Number(m) - 1 || built.getDate() !== Number(d)) {
      return null;
    }
    return built;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Build the window a report should cover.
 *
 * "This week" starts on Monday. That is the Nigerian working week, and a report
 * that resets on Sunday reads as wrong to everybody who works here.
 */
export function buildWindow(input: WindowInput): WindowResult {
  const now = input.now ?? new Date();

  if (input.mode === 'all') {
    return { window: null, error: null };
  }

  if (input.mode === 'custom') {
    const fromRaw = (input.from ?? '').trim();
    const toRaw = (input.to ?? '').trim();

    if (!fromRaw || !toRaw) {
      return { window: null, error: 'Choose both a start date and an end date.' };
    }

    const from = parseStoredDate(fromRaw);
    const to = parseStoredDate(toRaw);
    if (!from) return { window: null, error: `"${fromRaw}" is not a date I can read. Use the date picker.` };
    if (!to) return { window: null, error: `"${toRaw}" is not a date I can read. Use the date picker.` };

    // Compared as days, not as instants: a range that starts and ends on the same
    // calendar day is one day of data, not an empty range, which an instant
    // comparison would call empty when from === to at midnight.
    if (to.getTime() < startOfDay(from).getTime()) {
      return { window: null, error: 'The end date is before the start date. Swap them, or clear the range.' };
    }

    return {
      window: {
        from: startOfDay(from),
        to: startOfNextDay(to),
        label: `${fromRaw} to ${toRaw}`,
        mode: 'custom',
      },
      error: null,
    };
  }

  const today = startOfDay(now);

  if (input.mode === 'today') {
    return {
      window: { from: today, to: startOfNextDay(today), label: 'Today', mode: 'today' },
      error: null,
    };
  }

  if (input.mode === 'week') {
    // getDay() is 0 for Sunday; shift so Monday is the first day.
    const weekday = (today.getDay() + 6) % 7;
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - weekday, 0, 0, 0, 0);
    return {
      window: {
        from: monday,
        to: startOfNextDay(today),
        label: 'This week',
        mode: 'week',
      },
      error: null,
    };
  }

  if (input.mode === 'month') {
    const first = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0);
    return {
      window: {
        from: first,
        to: startOfNextDay(today),
        label: 'This month',
        mode: 'month',
      },
      error: null,
    };
  }

  const firstOfYear = new Date(today.getFullYear(), 0, 1, 0, 0, 0, 0);
  return {
    window: {
      from: firstOfYear,
      to: startOfNextDay(today),
      label: 'This year',
      mode: 'year',
    },
    error: null,
  };
}

/**
 * Whether a stored date falls inside the window.
 *
 * A null window means no restriction. An unparseable date is `null` from the
 * caller rather than `true`: a record whose date cannot be read is reported, not
 * guessed at, because including it in a revenue figure inflates the number and
 * excluding it understates it, and the person reading has to know which happened.
 */
export function withinWindow(stored: string | undefined | null, window: DateWindow | null): boolean {
  if (!window) return true;
  const parsed = parseStoredDate(stored);
  if (!parsed) return false;
  return parsed.getTime() >= window.from.getTime() && parsed.getTime() < window.to.getTime();
}

/** How many of `values` could not be read as a date, so the report can say so. */
export function countUnreadable(values: Array<string | undefined | null>): number {
  return values.filter(v => parseStoredDate(v) === null).length;
}

/** A short human description of a window, for the screen's own label. */
export function describeWindow(window: DateWindow | null): string {
  if (!window) return 'All time';
  if (window.mode !== 'custom') return window.label;

  const day = 1000 * 60 * 60 * 24;
  const days = Math.round((window.to.getTime() - window.from.getTime()) / day);
  const inclusive = days; // to is exclusive, so it is already the count of days
  return `${inclusive} day${inclusive === 1 ? '' : 's'} · ${window.label}`;
}