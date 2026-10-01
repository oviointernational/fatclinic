// Defect injection: prove scripts/access-selftest.mjs actually fails when access
// control is broken. A test that cannot detect the regression it exists for is
// not a test.
//
// This matters more here than it does elsewhere. The bug being guarded against is
// a menu item carrying a `roles?: string[]` field that nothing ever read: the
// type compiled, the menu rendered, the build passed, and every staff member saw
// every department. Anything that merely *looks* like access control - hiding a
// menu item, filtering a list - passes every casual check while leaving the app
// open. So each defect below is the plausible way somebody would re-break this,
// and the suite has to catch it.
//
// The original source is captured in memory at the start of THIS run and restored
// from those exact bytes at the end, which also proves the restore worked.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const TARGETS = {
  accessControl: path.join(ROOT, 'src', 'services', 'accessControl.ts'),
  navModel: path.join(ROOT, 'src', 'components', 'layout', 'navModel.ts'),
  permissions: path.join(ROOT, 'src', 'services', 'permissions.ts'),
  dateRange: path.join(ROOT, 'src', 'services', 'dateRange.ts'),
  clinicalFlow: path.join(ROOT, 'src', 'services', 'clinicalFlow.ts'),
  clinicalDashboard: path.join(ROOT, 'src', 'components', 'clinical', 'ClinicalDashboard.tsx'),
  clinicalDashboardPage: path.join(ROOT, 'src', 'components', 'clinical', 'ClinicalDashboardPage.tsx'),
  searchRank: path.join(ROOT, 'src', 'services', 'searchRank.ts'),
  useAccess: path.join(ROOT, 'src', 'hooks', 'useAccess.ts'),
  mainContainer: path.join(ROOT, 'src', 'components', 'layout', 'MainContainer.tsx'),
  sidebar2: path.join(ROOT, 'src', 'components', 'layout', 'Sidebar2.tsx'),
};

/** Where each injected source lives, for writing it back. */
const PATHS = {
  accessControl: ['services', 'accessControl.ts'],
  navModel: ['components', 'layout', 'navModel.ts'],
  permissions: ['services', 'permissions.ts'],
  dateRange: ['services', 'dateRange.ts'],
  clinicalFlow: ['services', 'clinicalFlow.ts'],
  clinicalDashboard: ['components', 'clinical', 'ClinicalDashboard.tsx'],
  clinicalDashboardPage: ['components', 'clinical', 'ClinicalDashboardPage.tsx'],
  searchRank: ['services', 'searchRank.ts'],
  useAccess: ['hooks', 'useAccess.ts'],
  mainContainer: ['components', 'layout', 'MainContainer.tsx'],
  sidebar2: ['components', 'layout', 'Sidebar2.tsx'],
};

/** Pristine bytes, read in-process so no backup can go stale. */
const ORIGINAL = new Map();
for (const [key, file] of Object.entries(TARGETS)) {
  ORIGINAL.set(key, fs.readFileSync(file, 'utf8'));
}
// Matching is done on line-ending-normalised copies, so a snippet written here
// with \n still finds its target in a CRLF source file.
const norm = (s) => s.replaceAll('\r\n', '\n');

// Timezone-dependent behaviour is invisible on a machine that happens to sit in
// UTC, which is most CI. A bare `YYYY-MM-DD` parsed with `new Date(str)` is a UTC
// instant, so on this machine "local midnight" and "UTC midnight" are the same
// hour and the bug cannot be seen. Running one check from Lagos (UTC+1, no
// daylight saving) and one from Los Angeles (UTC-8) makes them differ.
const TZ = { lagos: { TZ: 'Africa/Lagos' }, la: { TZ: 'America/Los_Angeles' } };

const DEFECTS = [
  {
    file: 'clinicalFlow',
    name: 'the date range is ignored, so the cards always show today whatever you pick',
    // The defining failure of a date filter: it is on screen and changes nothing.
    from: '  if (group.followsRange && !withinWindow(visit.visitDate, window)) return false;',
    to: '  if (false && group.followsRange && !withinWindow(visit.visitDate, window)) return false;',
    count: 1,
  },
  {
    file: 'clinicalFlow',
    name: 'the ward census is narrowed by the range, so an occupied ward can read as empty',
    // The dangerous one. A patient admitted on Tuesday is still in a bed today, so
    // filtering the census by date can report nobody in the ward while somebody is
    // lying in it - and the person reading believes it.
    from: "  { id: 'admitted', label: 'Admitted / In Ward', statuses: ['Admitted'], followsRange: false },",
    to: "  { id: 'admitted', label: 'Admitted / In Ward', statuses: ['Admitted'], followsRange: true },",
    count: 1,
  },
  {
    file: 'clinicalFlow',
    name: 'the ward filter is applied to the queues, so the doctor queue empties out',
    // A doctor-queue visit carries no ward, so filtering by ward hides all of them.
    from: '  if (group.id === WARD_CENSUS_GROUP_ID && ward && visit.ward !== ward) return false;',
    to: '  if (ward && visit.ward !== ward) return false;',
    count: 1,
  },
  {
    file: 'clinicalFlow',
    name: 'a patient with no ward vanishes from the census instead of appearing as UNSPECIFIED',
    from: "    const w = v.ward || 'UNSPECIFIED';\n    map.set(w, (map.get(w) || 0) + 1);",
    to: "    if (!v.ward) continue;\n    map.set(v.ward, (map.get(v.ward) || 0) + 1);",
    count: 1,
  },
  {
    file: 'clinicalFlow',
    name: 'encounters are counted twice when one patient has two in the same state',
    // Still a Set, still deduplicating — of the wrong thing. Keying by encounter
    // id is the realistic version of this mistake: two encounters for one patient
    // in the same state then read as two patients on one card.
    from: '    if (visitInGroup(v, group, window, ward)) ids.add(v.patientId);',
    to: '    if (visitInGroup(v, group, window, ward)) ids.add(v.id);',
    count: 1,
  },
  {
    file: 'clinicalDashboard',
    name: 'the header says today whatever range is chosen',
    from: '              Doctor &amp; Nursing flow • {describeWindow(win)}',
    to: '              Doctor &amp; Nursing flow • Today',
    count: 1,
  },
  {
    file: 'clinicalDashboard',
    name: 'a null window is read as "today", so All time is captioned as today',
    // "All time" builds to no window at all. Testing the window for "is this
    // today?" therefore says yes, and every card gets captioned "Today's flow"
    // over all-time numbers - the exact fault dateRange.ts was written to stop.
    from: "  const showingToday = mode === 'today';\n  const showingAllTime = mode === 'all';",
    to: "  const showingToday = !win || win.mode === 'today';\n  const showingAllTime = mode === 'all';",
    count: 1,
  },
  {
    file: 'clinicalDashboard',
    name: 'the screen stops saying that the ward census ignores the range',
    from: "{wardCensusIgnoresRange && ' Ward census below is NOT limited by this range — it shows everyone in a ward now, on any date.'}",
    to: "{false && ' Ward census below is NOT limited by this range.'}",
    count: 1,
  },
  {
    file: 'clinicalDashboardPage',
    name: 'the patient list falls back to today while the cards use the chosen range',
    // A card reading 12 above a list of 3, with nothing on screen to explain it.
    from: 'clinicalGroupPatientIds(visits, groupDef.id, window, ward)',
    to: "clinicalGroupPatientIds(visits, groupDef.id, buildWindow({ mode: 'today' }).window, ward)",
    count: 1,
  },
  {
    file: 'navModel',
    name: 'Billing goes back to being a column of its own, duplicating the Front Desk',
    // The repetition that was reported: the same billing screens, listed under a
    // second name, while Front Desk already carries four billing rows.
    from: "    anyOf: BILLING_KEYS, revenue: 'anyOfBilling', inMenu: false,",
    to: "    anyOf: BILLING_KEYS, revenue: 'anyOfBilling',",
    count: 1,
  },
  {
    file: 'mainContainer',
    name: 'a card navigates to the removed Billing column, stranding the screen outside the menu',
    // This is not hypothetical: the dashboard's billing card did exactly this, and
    // Central Billing opened with no row marked in the first column. Found by
    // clicking it in a browser, not by reading the code.
    // All four dashboard screens that open billing do so the same way, so the
    // injector reverts all four - putting back the old route even in one of them
    // is the same defect.
    from: "onNavigateBilling={() => onNavigate('patients', 'central_billing')}",
    to: "onNavigateBilling={() => onNavigate('billing', 'all_invoices')}",
    count: 4,
  },
  {
    file: 'accessControl',
    name: 'the menu ignores inMenu, so a screen reached from elsewhere is listed twice',
    from: 'return MAIN_NAV.filter(n => n.inMenu !== false && canOpenMainNav(user, n.id, customRole));',
    to: 'return MAIN_NAV.filter(n => canOpenMainNav(user, n.id, customRole));',
    count: 1,
  },
  {
    file: 'sidebar2',
    name: 'the submenu goes back to being a percentage, which clips its own labels',
    // The reported defect. `w-[20%]` of the workspace resolved to 80px on an
    // 892px window and the label text was rendered at zero width, so the column
    // looked like icons with no text. Nothing in the JSX is wrong when you read
    // it; only a real browser shows it.
    from: "asDrawer ? 'w-[190px]' : 'w-[240px]'",
    to: "asDrawer ? 'w-[190px]' : 'w-[20%]'",
    count: 2,
  },
  {
    file: 'mainContainer',
    name: 'the body goes back to being 70%, leaving a strip of nothing on the right',
    from: '<main className="flex-1 min-w-0 h-full flex flex-col overflow-hidden bg-light-bg dark:bg-dark-bg transition-colors">',
    to: '<main className="w-[70%] h-full flex flex-col overflow-hidden bg-light-bg dark:bg-dark-bg transition-colors">',
    count: 2,
  },
  {
    file: 'useAccess',
    name: 'the hook above the signed-out gate calls the hook that throws when signed out',
    // The defect that actually shipped. `/staff` was blank for every visitor: the
    // sign-in card is rendered by the signed-out branch of App, App calls
    // useAccess above that branch, and useCurrentUser raises - so the render that
    // exists to show the sign-in card is the render that dies.
    from: `  const { currentUser } = useAuth();`,
    to: `  useCurrentUser();
  const { currentUser } = useAuth();`,
    count: 1,
  },
  {
    file: 'accessControl',
    name: 'a signed-out visitor is allowed everything',
    // The other half of the same bug: if the deny-all stops denying, the blank
    // page would be replaced by a dashboard full of menus and no session.
    from: `export function denyAllAccess(): Access {
  const nothing = () => false;`,
    to: `export function denyAllAccess(): Access {
  const nothing = () => true;`,
    count: 1,
  },
  {
    file: 'accessControl',
    name: 'the signed-out route resolution invents a destination instead of refusing',
    from: `    resolveRoute: () => ({ nav: null, sub: null, refused: null, redirected: false }),`,
    to: `    resolveRoute: () => ({ nav: 'dashboard', sub: 'overview', refused: null, redirected: false }),`,
    count: 1,
  },
  {
    file: 'accessControl',
    name: 'the revenue gate is dropped, so a permission is the only check again',
    // The most attractive regression, because it is the smallest edit and looks
    // like a simplification: a doctor holds BILLING.INVOICES, so a permission
    // check alone shows them Central Billing and every revenue figure.
    // Anchored on the whole `canOpenSubNav` head, because the revenue line
    // appears in `canOpenMainNav` too and a snippet matching both would refuse to
    // inject rather than proving anything.
    from: `export function canOpenSubNav(user: User, nav: MainNavId, sub: SubNavId, customRole?: CustomRole): boolean {
  const item = allSubNavItems(nav).find(i => i.id === sub);
  // An id that is not in the submenu is refused rather than allowed through.
  // Failing open here would make any unrecognised id a way in, which is precisely
  // the "no matter how they manoeuvre their way" case: an unrecognised id does
  // not reach a screen, but it must not be treated as permission either.
  if (!item) return false;
  if (item.revenue && !canSeeRevenue(user, customRole)) return false;
  return grantedAnyOf(user, item.anyOf, customRole);`,
    to: `export function canOpenSubNav(user: User, nav: MainNavId, sub: SubNavId, customRole?: CustomRole): boolean {
  const item = allSubNavItems(nav).find(i => i.id === sub);
  if (!item) return false;
  return grantedAnyOf(user, item.anyOf, customRole);`,
    count: 1,
  },
  {
    file: 'accessControl',
    name: 'the money roles are widened to include the clinical ones',
    from: `export const REVENUE_ROLES: readonly string[] = ['ADMINISTRATOR', 'FRONT_DESK', 'BILLING_OFFICER'];`,
    to: `export const REVENUE_ROLES: readonly string[] = ['ADMINISTRATOR', 'FRONT_DESK', 'BILLING_OFFICER', 'PHYSICIAN', 'NURSE'];`,
    count: 1,
  },
  {
    file: 'accessControl',
    name: 'navigation stops being checked and simply honours the request',
    // This is "hide the menu item and call it done". The menu is filtered, so a
    // quick look says the gate works; asking for the destination by name walks
    // straight in.
    from: `export function resolveRoute(
  user: User,
  customRole: CustomRole | undefined,
  requestedNav: MainNavId,
  requestedSub: SubNavId,
): RouteDecision {
  const navAllowed = canOpenMainNav(user, requestedNav, customRole);`,
    to: `export function resolveRoute(
  user: User,
  customRole: CustomRole | undefined,
  requestedNav: MainNavId,
  requestedSub: SubNavId,
): RouteDecision {
  if (canOpenSubNav(user, requestedNav, requestedSub, customRole)) {
    return { nav: requestedNav, sub: requestedSub, refused: null, redirected: false };
  }
  const navAllowed = canOpenMainNav(user, requestedNav, customRole);`,
    count: 1,
  },
  {
    file: 'accessControl',
    name: 'a destination not in the menu is treated as allowed',
    // An unrecognised id does not reach a screen, so this looks harmless. But it
    // turns every future typo in a call site into a way past the gate.
    from: `  // the "no matter how they manoeuvre their way" case: an unrecognised id does
  // not reach a screen, but it must not be treated as permission either.
  if (!item) return false;`,
    to: `  // the "no matter how they manoeuvre their way" case: an unrecognised id does
  // not reach a screen, but it must not be treated as permission either.
  if (!item) return grantedAnyOf(user, ['DASHBOARD.VIEW']);`,
    count: 1,
  },
  {
    file: 'accessControl',
    name: 'a custom role falls back to the base role when it is empty',
    // Subtle and nasty: an account whose custom role was emptied keeps whatever
    // the base role grants, so revoking access by editing a role silently does
    // the opposite of revoking it. Only observable on a base role that would
    // otherwise have had the access, which is why the suite checks a Front Desk
    // clerk rather than a doctor.
    from: `  if (customRole) {
    return BILLING_KEYS.some(k => isEffectivelyGranted(customRole.permissions, k));
  }`,
    to: `  if (customRole && customRole.permissions.length > 0) {
    return BILLING_KEYS.some(k => isEffectivelyGranted(customRole.permissions, k));
  }`,
    count: 1,
  },
  {
    file: 'navModel',
    name: 'Histopathology is given to everyone with any laboratory department',
    // The exact complaint: a haematology-only scientist could reach histopathology.
    from: `{ id: 'histopathology', label: 'Histopathology', icon: 'Microscope', anyOf: [labKey('HISTOPATHOLOGY', 'VIEW')] },`,
    to: `{ id: 'histopathology', label: 'Histopathology', icon: 'Microscope', anyOf: [...LAB_VIEW_KEYS] },`,
    count: 1,
  },
  {
    file: 'navModel',
    name: 'a menu item loses its permission and inherits the department default',
    from: `{ id: 'pay_bills', label: 'Pay Bill / Cashier', icon: 'CreditCard', anyOf: ['BILLING.RECEIVE_PAYMENT'], revenue: true },`,
    to: `{ id: 'pay_bills', label: 'Pay Bill / Cashier', icon: 'CreditCard', anyOf: ['PATIENTS.VIEW'] },`,
    count: 1,
  },
  {
    file: 'navModel',
    name: 'a department door stops admitting the staff who work inside it',
    // Locks a stock clerk out of Stock, a registrar out of Register Patient.
    from: `    anyOf: [
      'PHARMACY.QUEUE.VIEW', 'PHARMACY.INVENTORY.VIEW', 'PHARMACY.CONSUMABLES.VIEW',
      'PHARMACY.CONSUMABLES.REQUEST_STOCK',
    ],`,
    to: `    anyOf: ['PHARMACY.QUEUE.VIEW', 'PHARMACY.INVENTORY.VIEW', 'PHARMACY.CONSUMABLES.VIEW'],`,
    count: 1,
  },
  {
    file: 'navModel',
    name: 'a permission key is mistyped',
    // Fails closed, so nobody sees anything wrong - the administrator simply
    // cannot see their own menu item and reports it as "the menu is broken".
    from: `anyOf: [labKey('MOLECULAR', 'VIEW')] },`,
    to: `anyOf: [labKey('MOLYMARKET', 'VIEW')] },`,
    count: 1,
  },
  {
    file: 'permissions',
    name: 'granting everything quietly omits a module',
    // The exact shape of the report: a role created with "all rights" that was
    // missing AI. Here the one-click button repeats it instead of fixing it.
    from: `export function grantEverything(): string[] {
  return PERMISSION_TREE.map(n => n.key).sort();
}`,
    to: `export function grantEverything(): string[] {
  return PERMISSION_TREE.filter(n => n.key !== 'AI').map(n => n.key).sort();
}`,
    count: 1,
  },
  {
    file: 'permissions',
    name: 'a role that fell behind is still reported as complete',
    from: `export function missingModules(selected: string[]): PermissionNode[] {
  return PERMISSION_TREE.filter(n => !isEffectivelyGranted(selected, n.key));
}`,
    to: `export function missingModules(selected: string[]): PermissionNode[] {
  return [];
}`,
    count: 1,
  },
  {
    file: 'permissions',
    name: 'the AI node is removed, so the AI menu has nothing to test against',
    // The reason the AI Assistant was visible to the front desk before.
    from: `    key: 'AI', label: 'Clinical AI Assistant',`,
    to: `    key: 'AI_DISABLED', label: 'Clinical AI Assistant',`,
    count: 1,
  },
  {
    file: 'dateRange',
    name: 'the end of a window is midnight instead of the end of the day',
    // "This month" then excludes everything since midnight today, and a custom
    // range ending on a date drops the whole day the person asked for. Silently.
    from: `        to: startOfNextDay(to),`,
    to: `        to: startOfDay(to),`,
    count: 1,
  },
  {
    file: 'dateRange',
    name: 'a bare date is parsed as a UTC instant instead of local time',
    // `new Date('2026-10-01')` is midnight UTC. In Lagos that is 01:00 local, so
    // "today" starts an hour late; in Los Angeles it is the previous day at 16:00,
    // so a record dated today lands in yesterday's window. Both are silent, and
    // neither can be seen from a machine in UTC - hence the timezone below.
    env: TZ.lagos,
    from: `    const built = new Date(Number(y), Number(m) - 1, Number(d));`,
    to: `    const built = new Date(\`\${y}-\${m}-\${d}\`);`,
    count: 1,
  },
  {
    file: 'dateRange',
    name: 'a calendar date that does not exist is rolled forward instead of rejected',
    // `2026-02-31` becomes the 3rd of March, so a mistyped date silently reports
    // on a different day than the one that was chosen.
    from: `    if (built.getFullYear() !== Number(y) || built.getMonth() !== Number(m) - 1 || built.getDate() !== Number(d)) {
      return null;
    }`,
    to: `    if (false) {
      return null;
    }`,
    count: 1,
  },
  {
    file: 'dateRange',
    name: 'the week starts on Sunday',
    from: `  const weekday = (today.getDay() + 6) % 7;`,
    to: `  const weekday = today.getDay();`,
    count: 1,
  },
  {
    file: 'dateRange',
    name: 'a reversed range silently becomes an empty window',
    from: `    if (to.getTime() < startOfDay(from).getTime()) {
      return { window: null, error: 'The end date is before the start date. Swap them, or clear the range.' };
    }`,
    to: `    if (to.getTime() < startOfDay(from).getTime()) {
      return { window: { from: startOfDay(to), to: startOfNextDay(from), label: fromRaw + ' to ' + toRaw, mode: 'custom' }, error: null };
    }`,
    count: 1,
  },
  {
    file: 'dateRange',
    name: 'an unreadable date is treated as inside every window',
    // Revenue figures that quietly count records nobody can place in the range.
    from: `  const parsed = parseStoredDate(stored);
  if (!parsed) return false;`,
    to: `  const parsed = parseStoredDate(stored);
  if (!parsed) return true;`,
    count: 1,
  },
  {
    file: 'searchRank',
    name: 'every match is ranked equally, so alphabetical order replaces relevance',
    // The classic autocomplete defect: the list "works", everything is findable,
    // and the thing that was meant is somewhere below the twenty that merely
    // contain the letters.
    from: `  if (at === 0) return MATCH_PREFIX;`,
    to: `  if (at === 0) return MATCH_ANYWHERE;`,
    count: 1,
  },
  {
    file: 'searchRank',
    name: 'a word-start match is treated the same as one buried mid-word',
    from: `  if (before === ' ' || before === '-' || before === '(' || before === ',') return MATCH_WORD_START;`,
    to: `  if (before === '\\u0000') return MATCH_WORD_START;`,
    count: 1,
  },
  {
    file: 'searchRank',
    name: 'the right-hand detail stops being searched',
    // Someone who knows "400mg" and not the brand can no longer find the drug.
    from: `    if (option.secondary && option.secondary.toLowerCase().includes(needle)) return MATCH_SECONDARY;`,
    to: `    return null;`,
    count: 1,
  },
  {
    file: 'searchRank',
    name: 'the list is no longer capped',
    // Renders the whole formulary into the DOM on every keystroke.
    from: `  return rankOptions(options, query).slice(0, limit).map(({ value, label, secondary, disabled }) => ({`,
    to: `  return rankOptions(options, query).map(({ value, label, secondary, disabled }) => ({`,
    count: 1,
  },
  {
    file: 'searchRank',
    name: 'the highlight is rebuilt from what was typed instead of sliced from the label',
    // The dangerous one. It puts text in the field that was never in the list, so
    // a prescription can be recorded under a name no formulary contains.
    from: `  return {
    before: label.slice(0, at),
    hit: label.slice(at, at + needle.length),
    after: label.slice(at + needle.length),
  };`,
    to: `  return {
    before: label.slice(0, at),
    hit: query,
    after: label.slice(at + needle.length),
  };`,
    count: 1,
  },
  {
    file: 'searchRank',
    name: 'matching becomes case-sensitive',
    from: `  const at = label.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return null;`,
    to: `  const at = label.indexOf(needle);
  if (at < 0) return null;`,
    count: 1,
  },
];

function readOriginal(key) {
  return norm(ORIGINAL.get(key));
}

function restore() {
  for (const [key, file] of Object.entries(TARGETS)) {
    const wanted = ORIGINAL.get(key);
    if (fs.readFileSync(file, 'utf8') !== wanted) {
      fs.writeFileSync(file, wanted);
    }
  }
}

/**
 * Restore on the way out, however we are leaving.
 *
 * This script rewrites real source files to break them on purpose. Between the
 * write and the restore, `src/` holds a defect, and a defect that outlives the
 * process is far worse than a test that failed: the next `npm test` reports a
 * failing check nobody introduced, and the obvious response - to "fix" the source
 * - deletes the code under test.
 *
 * That is not hypothetical. `node scripts/access-defects.mjs | Select-Object
 * -First 20` closes the pipeline once it has twenty lines, PowerShell stops the
 * upstream process, and node is killed before it reaches `restore()`. The tree
 * was left holding a real regression that the next run reported as a genuine
 * failure in the shipping code.
 *
 * So the restore is bound to `exit`, SIGINT and SIGTERM rather than only reached
 * on the happy path. It runs again on the way out even after the normal
 * in-loop restores, which is cheap and leaves nothing to chance.
 */
let restoredOnExit = false;
function restoreOnExit() {
  if (restoredOnExit) return;
  restoredOnExit = true;
  restore();
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    restoreOnExit();
    process.exit(130);
  });
}
process.on('exit', restoreOnExit);

function run(env) {
  try {
    const out = execFileSync(process.execPath, ['scripts/access-selftest.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...(env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out };
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

console.log('[defect injection] proving the access self-test detects each regression\n');

// The pristine source must pass to begin with, or "the suite fails" proves nothing.
const baseline = run();
if (!baseline.ok) {
  console.log('  the self-test does not pass on the pristine source; fix that first.');
  console.log(baseline.out.split('\n').filter((l) => /FAIL/.test(l)).slice(0, 5).join('\n'));
  process.exitCode = 1;
  restore();
} else {
  let survived = 0;

  for (const defect of DEFECTS) {
    const key = defect.file;
    const original = readOriginal(key);

    // `parts` injects several snippets in one file, which is how a defect that
    // needs a signature changed as well as a line changed is written. One part is
    // the normal case and is not written as an array.
    const parts = defect.parts ?? [{ from: defect.from, to: defect.to, count: defect.count }];
    let injected = original;
    let miss = null;

    for (const p of parts) {
      if (injected.split(p.from).length - 1 !== p.count) {
        miss = `${p.count} expected match(es) for a snippet in ${key}`;
        break;
      }
      injected = injected.replace(p.from, p.to);
    }

    if (miss) {
      console.log(`  ${defect.name}`);
      console.log(`      NOT INJECTED - ${miss}.`);
      survived++;
      continue;
    }

    fs.writeFileSync(path.join(ROOT, 'src', ...PATHS[key]), injected);

    const result = run(defect.env);
    const failing = result.out
      .split('\n')
      .filter((line) => line.includes('FAIL') || line.includes('FAILED'))
      .map((line) => line.trim().split(/\s{2,}/)[0]);

    console.log(`  ${defect.name}`);
    if (result.ok) {
      console.log('      NOT DETECTED - the self-test still passed.');
      survived++;
    } else {
      console.log(`      detected: ${failing.length} check(s) failed`);
      for (const line of failing.slice(0, 3)) console.log(`        - ${line}`);
    }

    restore();
  }

  const final = run();
  console.log('');
  if (final.ok) {
    const total = final.out.match(/all (\d+) checks/)?.[1];
    console.log(`  [defect injection] every defect was caught; original restored, ${total} checks pass`);
  } else {
    console.log('  [defect injection] FAILED to restore: the self-test fails on the pristine file.');
    process.exitCode = 1;
  }

  if (survived) {
    console.log(`  [defect injection] ${survived} defect(s) slipped through`);
    process.exitCode = 1;
  }
  console.log('');
}
