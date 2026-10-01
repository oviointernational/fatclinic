/**
 * Does the navigation gate actually hold?
 *
 * WHY THIS IS A SEPARATE SUITE
 * ----------------------------
 * `sync-selftest.mjs` guards what the application writes to the database. This
 * guards what it shows. The defect being guarded against is specific and was
 * real: a `roles?: string[]` field on every menu item, typed and formatted and
 * read by nobody, so every staff member saw every department. A suite that only
 * round-trips data would have passed while that was true, and it did.
 *
 * THE CENTRAL CLAIM
 * -----------------
 * "A user must not be able to navigate to a department they do not have, no
 * matter how they manoeuvre their way." That is not satisfied by hiding a menu
 * item, so the suite does not settle for that. It takes the statement literally
 * and brute-forces it: every role, against every main destination, against every
 * submenu id in the entire application, including ids nobody links to. Whatever
 * `resolveRoute` answers, the suite checks that the person could legitimately
 * have opened that place. One counter-example fails the run.
 *
 * The same is checked for the revenue gate against every money-flagged item.
 */
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Same shim `sync-selftest.mjs` uses: the sources are TypeScript with
// extensionless relative imports. Node strips the types; this supplies the
// extension so the suite exercises the real modules, not copies of them.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const fromDir = context.parentURL
        ? path.dirname(fileURLToPath(context.parentURL))
        : ROOT;
      if (fs.existsSync(path.join(fromDir, specifier, 'index.ts'))) {
        return nextResolve(`${specifier}/index.ts`, context);
      }
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // Not a .ts file; fall through.
      }
    }
    return nextResolve(specifier, context);
  },
});

const {
  MAIN_NAV, SUB_NAV, allSubNavItems,
} = await import('../src/components/layout/navModel.ts');

const {
  PERMISSION_TREE, allDescendants, isEffectivelyGranted, BASE_ROLE_PERMISSIONS,
  grantEverything, missingModules, countGranted, totalPermissionCount,
} = await import('../src/services/permissions.ts');

const {
  canSeeRevenue, canOpenMainNav, canOpenSubNav, permittedMainNavs, permittedSubNavs,
  firstPermittedNav, firstPermittedSub, resolveRoute, deniedReason,
  denyAllAccess, accessFor,
} = await import('../src/services/accessControl.ts');

const {
  buildWindow, withinWindow, parseStoredDate, countUnreadable, describeWindow,
} = await import('../src/services/dateRange.ts');

const {
  filterAndRank, rankMatch, matchSpan, rankOptions,
} = await import('../src/services/searchRank.ts');

const {
  CLINICAL_FLOW_GROUPS, RANGED_FLOW_GROUPS, WARD_CENSUS_GROUP_ID,
  clinicalGroupPatientIds, clinicalGroupCounts, admittedByWard,
  visitInGroup, findFlowGroup,
} = await import('../src/services/clinicalFlow.ts');

// ---------------------------------------------------------------------------

let checks = 0;
let failures = 0;
let lastSection = '';

function check(name, ok, detail) {
  checks++;
  if (!ok) {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  lastSection = title;
  console.log(`\n${title}`);
}

const user = (role) => ({ id: `u-${role}`, name: `Test ${role}`, role });
const asUser = (role, customRoleId) => ({ ...user(role), customRoleId });
const customRole = (name, permissions) => ({
  id: `cr-${name}`, name, description: '', permissions, isSystem: false,
});

const ROLES = Object.keys(BASE_ROLE_PERMISSIONS);

// ---------------------------------------------------------------------------
// The menu itself is well formed
// ---------------------------------------------------------------------------

section('the menu is well formed');

// Every permission the menu cites must exist in the tree. This is the check that
// catches a typo such as `LABORATORY.MOLYMARKET.VIEW`: such a key is never
// granted to anybody, so the item would silently disappear for every role,
// including the administrator who wrote it. A mistyped key fails closed, which is
// safe, but it is still a bug that reads as "the administrator cannot see their
// own menu".
const allPermissionKeys = new Set();
for (const node of PERMISSION_TREE) {
  allPermissionKeys.add(node.key);
  for (const d of allDescendants(node.key)) allPermissionKeys.add(d);
}

const mainNavKeys = MAIN_NAV.flatMap(n => n.anyOf);
const subNavKeys = Object.values(SUB_NAV).flatMap(g =>
  allSubNavItemsFor(g).flatMap(i => i.anyOf));

check('the permission tree has nodes to check against', allPermissionKeys.size > 50, `${allPermissionKeys.size} keys`);
check('every main navigation permission exists in the tree',
  mainNavKeys.every(k => allPermissionKeys.has(k)),
  mainNavKeys.filter(k => !allPermissionKeys.has(k)).join(', '));
check('every submenu permission exists in the tree',
  subNavKeys.every(k => allPermissionKeys.has(k)),
  subNavKeys.filter(k => !allPermissionKeys.has(k)).join(', '));

// Every item needs a permission, and a non-empty list of them. The type requires
// it; this asserts the value is not an empty array, which the type cannot.
const everyItem = [
  ...MAIN_NAV.map(n => ({ id: `main:${n.id}`, anyOf: n.anyOf })),
  ...Object.entries(SUB_NAV).flatMap(([nav, g]) =>
    allSubNavItemsFor(g).map(i => ({ id: `sub:${nav}/${i.id}`, anyOf: i.anyOf }))),
];
check('no menu item has an empty permission list',
  everyItem.every(i => Array.isArray(i.anyOf) && i.anyOf.length > 0),
  everyItem.filter(i => !i.anyOf || i.anyOf.length === 0).map(i => i.id).join(', '));

// Every submenu item must be openable by somebody who can open its own parent.
// Checking only "at least one child is reachable" is too weak: a department whose
// Stock screen needs `LABORATORY.HEMATOLOGY.LOG_USAGE` while the department door
// only admits `.VIEW` passes that loose test and still locks a stock clerk out of
// the room their job is in.
for (const nav of MAIN_NAV) {
  const group = SUB_NAV[nav.id];
  if (!group) continue;
  const orphans = allSubNavItemsFor(group)
    .filter(s => !s.anyOf.some(k => nav.anyOf.includes(k)))
    .map(s => `${s.id} needs [${s.anyOf.join('|')}]`);
  check(`every screen under "${nav.label}" is reachable by someone its own door admits`,
    orphans.length === 0, orphans.join('; '));
}

function allSubNavItemsFor(group) {
  const out = [];
  const walk = (items) => {
    for (const i of items) {
      out.push(i);
      if (i.subItems) walk(i.subItems);
    }
  };
  walk(group.items);
  return out;
}

// ---------------------------------------------------------------------------
// The reported defect: a role must not see, or reach, a department it lacks
// ---------------------------------------------------------------------------

section('a role cannot see or reach a department it does not have');

// The scenario as described: Medical Lab, not Pharmacy.
const labUser = user('LAB_SCIENTIST');
check('a laboratory scientist cannot open the Pharmacy menu',
  !permittedMainNavs(labUser).some(n => n.id === 'pharmacy'));
check('a laboratory scientist cannot open Radiology',
  !canOpenMainNav(labUser, 'radiology'));
check('a laboratory scientist cannot open Physiotherapy',
  !canOpenMainNav(labUser, 'physiotherapy'));
check('a laboratory scientist cannot open Billing',
  !canOpenMainNav(labUser, 'billing'));
check('a laboratory scientist cannot open Administration',
  !canOpenMainNav(labUser, 'admin'));
check('a laboratory scientist CAN open Laboratory',
  canOpenMainNav(labUser, 'laboratory'));
check('a laboratory scientist CAN open the dashboard they land on',
  canOpenMainNav(labUser, 'dashboard'));

// Navigating there anyway must be refused, not merely unlisted.
const labAttempt = resolveRoute(labUser, undefined, 'pharmacy', 'rx_queue');
check('navigating to Pharmacy is refused even when asked for by name',
  labAttempt.nav !== 'pharmacy' && labAttempt.nav !== null,
  `landed on ${labAttempt.nav}/${labAttempt.sub}`);
check('and it lands somewhere the laboratory scientist may actually open',
  canOpenMainNav(labUser, labAttempt.nav) && canOpenSubNav(labUser, labAttempt.nav, labAttempt.sub));
check('and it explains itself in words',
  typeof labAttempt.refused === 'string' && labAttempt.refused.length > 20,
  String(labAttempt.refused));

// The Pharmacy submenu must be empty for them, not merely greyed out.
check('the Pharmacy submenu is empty for a laboratory scientist',
  permittedSubNavs(labUser, 'pharmacy').length === 0);

// A laboratory scientist holding every department by default: this is the second
// half of the same complaint, and it is why custom roles exist.
check('a laboratory scientist with no custom role has all five departments',
  ['hematology', 'microbiology', 'chemical_pathology', 'histopathology', 'molecular']
    .every(d => canOpenSubNav(labUser, 'laboratory', d)),
  'so the base role must be narrowed by a custom role, which is tested next');

// Hematology only, as described: histopathology must disappear unless granted.
const hemOnly = customRole('Hem only', [
  'DASHBOARD.VIEW', 'LABORATORY.HEMATOLOGY', 'LABORATORY.INVENTORY.VIEW',
]);
const hemUser = asUser('LAB_SCIENTIST', 'cr-Hem only');
const hemSubs = permittedSubNavs(hemUser, 'laboratory', hemOnly).map(s => s.id);

check('a haematology-only scientist CAN open Hematology',
  hemSubs.includes('hematology'), hemSubs.join(', '));
check('and CANNOT open Histopathology',
  !hemSubs.includes('histopathology'), hemSubs.join(', '));
check('and CANNOT open Microbiology',
  !hemSubs.includes('microbiology'), hemSubs.join(', '));
check('and CANNOT open Molecular',
  !hemSubs.includes('molecular'), hemSubs.join(', '));
check('and CANNOT open Chemical Pathology',
  !hemSubs.includes('chemical_pathology'), hemSubs.join(', '));
check('and can still open Test Inventory, which was granted',
  hemSubs.includes('lab_inventory'), hemSubs.join(', '));
check('and cannot open Pharmacy either, since no pharmacy key was granted',
  !canOpenMainNav(hemUser, 'pharmacy', hemOnly));

// A parent whose every child is hidden must go too. "All Departments" and
// "Released Reports" are gated on any department, so one granted department is
// enough to keep them — but a scientist granted only stock handling has no
// department at all, and both must disappear rather than open an empty screen.
const stockOnly = customRole('Stock only', ['DASHBOARD.VIEW', 'LABORATORY.HEMATOLOGY.LOG_USAGE']);
const stockSubs = permittedSubNavs(asUser('LAB_SCIENTIST', 'cr-Stock only'), 'laboratory', stockOnly).map(s => s.id);
check('a scientist with only stock handling has no All Departments row',
  !stockSubs.includes('lab_all'), stockSubs.join(', '));
check('...and no Released Reports row either',
  !stockSubs.includes('lab_released'), stockSubs.join(', '));
check('...but does have Stock',
  stockSubs.includes('lab_stock'), stockSubs.join(', '));

// "unless granted view/add" — grant exactly the view and it appears.
const grantedCustom = customRole('Hem + histopath view', [
  'DASHBOARD.VIEW', 'LABORATORY.HEMATOLOGY', 'LABORATORY.HISTOPATHOLOGY',
]);
const grantedUser = asUser('LAB_SCIENTIST', 'granted');
check('granting the view permission makes Histopathology appear',
  canOpenSubNav(grantedUser, 'laboratory', 'histopathology', grantedCustom));
check('and it is reachable, not merely listed',
  resolveRoute(grantedUser, grantedCustom, 'laboratory', 'histopathology').nav === 'laboratory');

// The whole point of custom roles: the same base role, a different department.
check('the same base role with only Haematology still cannot reach Histopathology',
  !canOpenSubNav(hemUser, 'laboratory', 'histopathology', hemOnly));

// ---------------------------------------------------------------------------
// Revenue: Administrator, Front Desk and Billing Officer only
// ---------------------------------------------------------------------------

section('revenue is limited to Administrator, Front Desk and Billing Officer');

const REVENUE_ROLES = ['ADMINISTRATOR', 'FRONT_DESK', 'BILLING_OFFICER'];
const NO_REVENUE_ROLES = ROLES.filter(r => !REVENUE_ROLES.includes(r));

for (const role of REVENUE_ROLES) {
  check(`${role} may see revenue`, canSeeRevenue(user(role)));
}
for (const role of NO_REVENUE_ROLES) {
  check(`${role} may NOT see revenue`, !canSeeRevenue(user(role)));
}

// The money screens themselves.
const MONEY_SUBS = [
  ['patients', 'pay_bills'], ['patients', 'central_billing'], ['patients', 'front_desk_billing'],
  ['patients', 'price_schedule'], ['billing', 'all_invoices'], ['billing', 'process_payment'],
  ['analytics', 'financial_stats'], ['radiology', 'radiology_pricing'],
  ['physiotherapy', 'physio_pricing'],
];

for (const role of NO_REVENUE_ROLES) {
  const visible = MONEY_SUBS.filter(([nav, sub]) => canOpenSubNav(user(role), nav, sub));
  check(`${role} cannot open any billing or revenue screen`,
    visible.length === 0, visible.map(([n, s]) => `${n}/${s}`).join(', '));
  check(`${role} cannot open the Billing menu`,
    !canOpenMainNav(user(role), 'billing'));
}

for (const role of REVENUE_ROLES) {
  const reachable = MONEY_SUBS.filter(([nav, sub]) => canOpenSubNav(user(role), nav, sub));
  check(`${role} can open at least one billing screen`, reachable.length > 0);
}

// The physician is the sharp case: the base role grants BILLING.INVOICES so the
// invoice numbers on their own orders resolve, and they must still see no money.
const physician = user('PHYSICIAN');
check('a doctor holds BILLING.INVOICES in the base role',
  isEffectivelyGranted(BASE_ROLE_PERMISSIONS.PHYSICIAN, 'BILLING.INVOICES'));
check('and is still refused revenue despite holding it',
  !canSeeRevenue(physician));
check('and cannot open Central Billing despite holding BILLING.INVOICES',
  !canOpenSubNav(physician, 'patients', 'central_billing'));
check('and cannot open Pay Bill / Cashier',
  !canOpenSubNav(physician, 'patients', 'pay_bills'));
check('and cannot open the Master Price Schedule',
  !canOpenSubNav(physician, 'patients', 'price_schedule'));
check('and cannot open the Billing menu',
  !canOpenMainNav(physician, 'billing'));
check('but CAN still see Diagnostic Alerts, which is a clinical screen',
  canOpenSubNav(physician, 'clinical', 'lab_alerts'));
check('and CAN still open the Patient Directory, which is clinical too',
  canOpenSubNav(physician, 'patients', 'all_patients'));

// A custom role that grants billing decides its role handles money. Judging by the
// base role instead would show it the invoices and hide the revenue card.
const billingCustom = customRole('Some billing clerk', [
  'DASHBOARD.VIEW', 'PATIENTS.VIEW', 'BILLING.INVOICES',
]);
check('a custom role granted BILLING.INVOICES may see revenue',
  canSeeRevenue(asUser('NURSE', 'billing'), billingCustom));
check('because it cannot be shown the invoices and not the revenue they produce',
  canOpenSubNav(asUser('NURSE', 'billing'), 'patients', 'central_billing', billingCustom));

const noBillingCustom = customRole('Vitals only', ['DASHBOARD.VIEW', 'CLINICAL.NURSING']);
check('a clinical custom role is refused revenue', !canSeeRevenue(asUser('NURSE', 'vitals'), noBillingCustom));
check('and refused Central Billing',
  !canOpenSubNav(asUser('NURSE', 'vitals'), 'patients', 'central_billing', noBillingCustom));

// Narrowing by custom role, then editing that role, is how access is taken away
// in practice. Both directions are checked, and the second one matters most: a
// role edited down to nothing must leave the account with nothing, not quietly
// restore everything the base role granted. Getting that backwards makes revoking
// access impossible — the administrator removes every permission, saves, and the
// clerk keeps the money.
const narrowedClerk = customRole('Reception, no money', [
  'DASHBOARD.VIEW', 'PATIENTS.VIEW', 'PATIENTS.REGISTER', 'PATIENTS.BOOKINGS',
]);
const clerkUser = asUser('FRONT_DESK', 'reception');
check('a Front Desk clerk narrowed to reception loses revenue',
  !canSeeRevenue(clerkUser, narrowedClerk));
check('...and keeps the screens they were left with',
  canOpenSubNav(clerkUser, 'patients', 'all_patients', narrowedClerk)
  && canOpenSubNav(clerkUser, 'patients', 'register_patient', narrowedClerk));

const emptiedRole = customRole('Reception, nothing left', []);
check('emptying that role removes revenue rather than restoring it',
  !canSeeRevenue(clerkUser, emptiedRole),
  'a Front Desk clerk with an empty custom role must not fall back to the base role');
check('...and empties the menu rather than falling back to it',
  permittedMainNavs(clerkUser, emptiedRole).length === 0,
  permittedMainNavs(clerkUser, emptiedRole).map(n => n.id).join(', '));

// ---------------------------------------------------------------------------
// Every destination has a rule, and an unknown id is refused
// ---------------------------------------------------------------------------

section('no destination is reachable by accident');

for (const nav of MAIN_NAV) {
  const subs = allSubNavItems(nav.id);
  for (const sub of subs) {
    const rule = allSubNavItems(nav.id).find(i => i.id === sub.id);
    check(`submenu "${nav.id}/${sub.id}" has a permission rule`, !!rule && rule.anyOf.length > 0);
  }
}

// An id that is not in the menu is refused, not treated as permitted. Failing
// open here would make a typo in a future call site a way in.
for (const role of ROLES) {
  const invented = resolveRoute(user(role), undefined, 'dashboard', 'no_such_screen');
  check(`${role} landing after asking for an unknown screen can still open where they land`,
    invented.nav && canOpenMainNav(user(role), invented.nav)
      && canOpenSubNav(user(role), invented.nav, invented.sub),
    `landed on ${invented.nav}/${invented.sub}`);
  check(`${role} is told the screen does not exist rather than being shown one`,
    /no screen called|not part of/i.test(invented.refused ?? ''), String(invented.refused));
}

// ---------------------------------------------------------------------------
// The central claim, brute-forced
// ---------------------------------------------------------------------------

section('no role can land anywhere it may not open (every role x every screen)');

// This is the check that matches the request. For every role, for every main
// destination in the application, and for every submenu id in the application,
// ask `resolveRoute` and then verify the answer. No id is excluded as
// "unreachable" or "not linked from anywhere" — the point is that a person should
// not be able to get there by any means at all, so no route is assumed innocent.
const allSubIds = Object.keys(SUB_NAV).flatMap(nav => allSubNavItems(nav).map(s => s.id));
const nonsenseIds = ['', 'undefined', 'null', '../admin', '__proto__', 'ADMIN', 'toString'];

let counterExamples = [];
let routesChecked = 0;

for (const role of ROLES) {
  const u = user(role);
  for (const nav of MAIN_NAV) {
    for (const sub of [...allSubIds, ...nonsenseIds]) {
      routesChecked++;
      const d = resolveRoute(u, undefined, nav, sub);
      if (!d.nav || !d.sub) {
        counterExamples.push(`${role} -> ${nav}/${sub} produced nothing to open`);
        continue;
      }
      if (!canOpenMainNav(u, d.nav)) {
        counterExamples.push(`${role} -> ${nav}/${sub} landed on main nav ${d.nav}, which they may not open`);
      }
      if (!canOpenSubNav(u, d.nav, d.sub)) {
        counterExamples.push(`${role} -> ${nav}/${sub} landed on ${d.nav}/${d.sub}, which they may not open`);
      }
      if (d.nav !== nav) {
        // Being moved is fine. Being moved without being told is not, because a
        // silent redirect reads as a broken application.
        if (!d.refused) {
          counterExamples.push(`${role} -> ${nav}/${sub} was redirected to ${d.nav}/${d.sub} without saying so`);
        }
      }
    }
  }
}

check(`every one of ${routesChecked} navigation attempts lands somewhere openable`,
  counterExamples.length === 0,
  counterExamples.slice(0, 5).join(' | ') + (counterExamples.length > 5 ? ` (+${counterExamples.length - 5} more)` : ''));

// The same sweep with a custom role, since a custom role is what a real
// deployment uses to narrow somebody's access.
let customCounterExamples = [];
const narrowCustoms = [
  customRole('nothing at all', []),
  customRole('dashboard only', ['DASHBOARD.VIEW']),
  customRole('one lab dept', ['LABORATORY.HEMATOLOGY']),
  customRole('billing clerk', ['BILLING.INVOICES', 'PATIENTS.VIEW']),
  customRole('everything but admin', ['DASHBOARD', 'PATIENTS', 'CLINICAL', 'LABORATORY', 'PHARMACY', 'RADIOLOGY', 'PHYSIOTHERAPY', 'BILLING', 'AI']),
];

for (const cr of narrowCustoms.filter(r => r.permissions.length > 0)) {
  const u = asUser('PHYSICIAN', cr.id);
  for (const nav of MAIN_NAV) {
    for (const sub of allSubIds) {
      const d = resolveRoute(u, cr, nav.id, sub);
      if (!d.nav || !d.sub) { customCounterExamples.push(`${cr.name} -> ${nav.id}/${sub} produced nothing`); continue; }
      if (!canOpenMainNav(u, d.nav, cr)) customCounterExamples.push(`${cr.name} -> ${nav.id}/${sub} landed on ${d.nav}`);
      if (!canOpenSubNav(u, d.nav, d.sub, cr)) customCounterExamples.push(`${cr.name} -> ${nav.id}/${sub} landed on ${d.nav}/${d.sub}`);
      // Nobody who has an openable screen should ever be told they cannot open it.
      if (d.nav === nav.id && canOpenSubNav(u, nav.id, sub, cr) && d.refused) {
        customCounterExamples.push(`${cr.name} was refused ${nav.id}/${sub} which it may open`);
      }
    }
  }
}
// A role with no permissions at all genuinely has nowhere to go, and "nowhere" is
// the honest answer rather than a fallback somewhere else. It is checked apart
// above, because asserting it lands somewhere would assert a lie.
check('the same holds for every custom role shape',
  customCounterExamples.length === 0,
  customCounterExamples.slice(0, 5).join(' | '));

// ---------------------------------------------------------------------------
// Administrator sees everything, and nobody is left with nothing
// ---------------------------------------------------------------------------

section('no account is stranded');

for (const role of ROLES) {
  const first = firstPermittedNav(user(role));
  check(`${role} has somewhere to land`, first !== null);
  if (first) {
    check(`${role} lands on a screen they may open`,
      canOpenSubNav(user(role), first, firstPermittedSub(user(role), first)),
      `${first}/${firstPermittedSub(user(role), first)}`);
  }
}

check('an empty custom role is stranded on purpose, not by accident',
  firstPermittedNav(asUser('PHYSICIAN', 'cr-nothing at all'), narrowCustoms[0]) === null);

const stranded = resolveRoute(asUser('PHYSICIAN', 'cr-nothing at all'), narrowCustoms[0], 'dashboard', 'overview');
check('an account with nothing granted is told to ask an administrator',
  stranded.nav === null && stranded.sub === null);

// An account with nothing must not be able to see a single menu item.
const nothingUser = asUser('PHYSICIAN', 'cr-nothing at all');
check('an account with no grants sees no menus at all',
  permittedMainNavs(nothingUser, narrowCustoms[0]).length === 0);

// Administrator: the one role that must not be locked out of its own system.
const admin = user('ADMINISTRATOR');
const adminHidden = MAIN_NAV.filter(n => !canOpenMainNav(admin, n.id));
check('the administrator can open every main destination', adminHidden.length === 0,
  adminHidden.map(n => n.id).join(', '));
let adminHiddenSubs = [];
for (const nav of MAIN_NAV) {
  for (const s of allSubNavItems(nav.id)) {
    if (!canOpenSubNav(admin, nav.id, s.id)) adminHiddenSubs.push(`${nav.id}/${s.id}`);
  }
}
check('the administrator can open every screen', adminHiddenSubs.length === 0, adminHiddenSubs.join(', '));

// ---------------------------------------------------------------------------
// The menu does not list a destination twice under two names
// ---------------------------------------------------------------------------

section('a screen reached from elsewhere is not also a column of its own');

/*
 * Billing and Analytics were both in the first column while the identical
 * screens were already one click away - Billing as the Front Desk's four billing
 * rows and the dashboard's Billing card, Analytics as `dashboard -> analytics`,
 * which renders the same component. Not a different department offered twice; the
 * same department.
 *
 * The interesting part is not that they are removed from the menu. It is that
 * removing a menu row must not remove the only way into a screen, and must not
 * leave somebody with no menu at all. Both are checked below rather than
 * assumed, because this is a clinical system and a person who cannot reach the
 * cashier cannot take a payment.
 */

const notInMenu = MAIN_NAV.filter(n => n.inMenu === false);
check('exactly Billing and Analytics are reached from elsewhere',
  notInMenu.map(n => n.id).sort().join(',') === 'analytics,billing',
  notInMenu.map(n => n.id).join(', ') || 'none marked');

// They are destinations, not screens that were deleted. The gate must still work.
for (const n of notInMenu) {
  check(`${n.id} is still a real, gated destination`, (() => {
    if (!SUB_NAV[n.id]) return false;
    const subs = allSubNavItems(n.id);
    if (subs.length === 0) return false;
    // At least one role can get in, and at least one cannot.
    return subs.some(s => canOpenSubNav(user('ADMINISTRATOR'), n.id, s.id))
      && !canOpenSubNav(user('FRONT_DESK'), n.id, 'nl_query');
  })());

  check(`${n.id} is not offered to anyone as a menu row`,
    ROLES.every(r => !permittedMainNavs(user(r)).some(x => x.id === n.id)),
    ROLES.filter(r => permittedMainNavs(user(r)).some(x => x.id === n.id)).join(', '));
}

// A refusal must never land somebody on a screen with no menu row above it: they
// would be stuck, with no way back into the application.
for (const role of ROLES) {
  const landed = firstPermittedNav(user(role));
  check(`${role} is never stranded on a screen with no menu row`,
    landed === null || MAIN_NAV.find(n => n.id === landed)?.inMenu !== false,
    `landed on ${landed}`);
}

// And the brute force: nobody's menu is emptied by removing these two rows.
for (const role of ROLES) {
  const menu = permittedMainNavs(user(role));
  const reachable = menu.length > 0
    ? menu.some(m => permittedSubNavs(user(role), m.id).length > 0)
    : false;
  check(`${role} still has a column and it leads somewhere`, reachable,
    `${menu.length} column(s)`);
}

// The specific case that worried us: a Billing Officer's whole job is behind that
// door. They must still be able to do it, through Front Desk.
const officer = user('BILLING_OFFICER');
check('a Billing Officer can still take a payment', canOpenSubNav(officer, 'patients', 'pay_bills'));
check('a Billing Officer can still open an invoice', canOpenSubNav(officer, 'patients', 'central_billing'));
check('a Billing Officer can still see the price schedule', canOpenSubNav(officer, 'patients', 'price_schedule'));
check('a Billing Officer reaches analytics through the dashboard',
  canOpenSubNav(officer, 'dashboard', 'analytics'));
check('and the billing destination they are sent to is one they may open',
  canOpenMainNav(officer, 'billing') && canOpenSubNav(officer, 'billing', 'all_invoices'));

/*
 * `billing/all_invoices` and `patients/central_billing` are the same screen twice:
 * both render `<CentralBilling initialTab="invoices" />`. Same for the cashier and
 * the price schedule. Repointing the dashboard's Billing card from one to the other
 * is therefore free - provided the gate really is identical, which is asserted for
 * every role rather than reasoned about. If a role could open the old route but
 * not the new one, the card would have started refusing people who could
 * previously use it, and no reading of the source would have shown that.
 */
const SAME_SCREEN_TWICE = [
  ['billing', 'all_invoices', 'patients', 'central_billing', 'All Invoices / Central Billing'],
  ['billing', 'process_payment', 'patients', 'pay_bills', 'Cashier'],
  ['billing', 'price_schedule', 'patients', 'price_schedule', 'Price Schedule'],
];

for (const role of ROLES) {
  for (const [navA, subA, navB, subB, what] of SAME_SCREEN_TWICE) {
    const a = canOpenSubNav(user(role), navA, subA);
    const b = canOpenSubNav(user(role), navB, subB);
    check(`${role} reaches ${what} the same way through either route`, a === b,
      `${navA}/${subA}=${a} but ${navB}/${subB}=${b}`);
  }
}

// A nurse must not have gained the invoice list by this rearrangement.
const nurse = user('NURSE');
check('a nurse still cannot open an invoice', !canOpenSubNav(nurse, 'patients', 'central_billing'));
check('a nurse still cannot open the price schedule', !canOpenSubNav(nurse, 'patients', 'price_schedule'));
check('a nurse still cannot see revenue analytics', !canOpenSubNav(nurse, 'analytics', 'financial_stats'));

// ---------------------------------------------------------------------------
// Refusals say something true
// ---------------------------------------------------------------------------

section('a refusal explains itself');

const r1 = deniedReason(user('PHYSICIAN'), 'patients', 'central_billing');
check('a revenue refusal names the roles that may see it',
  /Administrator, Front Desk and Billing Officer/.test(r1), r1);
check('a revenue refusal names the person\'s own role',
  /Doctor/.test(r1), r1);
check('a revenue refusal does not say "access denied" and nothing else',
  r1.length > 80, `${r1.length} chars`);

const r2 = deniedReason(hemUser, 'laboratory', 'histopathology');
check('a permission refusal says who can grant it',
  /Roles & Permissions/.test(r2), r2);
check('a permission refusal names the person\'s role',
  /Laboratory Scientist/.test(r2), r2);

// ---------------------------------------------------------------------------
// The AI menu, which had no permission at all
// ---------------------------------------------------------------------------

section('the AI menu is no longer visible to everybody');

check('the permission tree now has an AI node',
  PERMISSION_TREE.some(n => n.key === 'AI'));
for (const role of ['PHYSICIAN', 'NURSE', 'LAB_SCIENTIST']) {
  check(`${role} may use the AI assistant`, canOpenSubNav(user(role), 'ai', 'nl_query'));
}
for (const role of ['FRONT_DESK', 'BILLING_OFFICER']) {
  check(`${role} may NOT use the AI assistant`,
    !canOpenSubNav(user(role), 'ai', 'nl_query'));
  check(`${role} does not see the AI menu`,
    !canOpenMainNav(user(role), 'ai'));
}

// ---------------------------------------------------------------------------
// "Give this role all rights" has to mean all of them
// ---------------------------------------------------------------------------

section('a role meant to have all rights has all of them, and says so when it does not');

// The complaint this section answers: an access-control role was created, given
// everything, assigned to a doctor - and the doctor could not see the AI
// Assistant. Not a broken gate and not a broken assignment. Two ordinary things
// had happened at once:
//
//   1. `AI` was added to `PERMISSION_TREE` with the navigation gate, which is
//      after that role was saved. A stored role is the set of keys it held at
//      that moment, so it cannot contain a module that did not exist yet.
//   2. Assigning a custom role REPLACES the base role rather than adding to it.
//      The doctor's own base grants included `AI`, so assigning the custom role
//      took the AI Assistant away from them.
//
// Nothing in the editor said so. It offered a checkbox per node and no way to
// reach "everything" in one action, and the role card printed "122 permissions
// granted", which reads as complete.

check('there is a one-click way to grant everything', typeof grantEverything === 'function');

const everything = grantEverything();
check('granting everything is a real grant of every top-level module',
  PERMISSION_TREE.every(n => isEffectivelyGranted(everything, n.key)),
  PERMISSION_TREE.filter(n => !isEffectivelyGranted(everything, n.key)).map(n => n.key).join(', '));
check('and it covers every single permission in the application',
  countGranted(everything) === totalPermissionCount(),
  `${countGranted(everything)} of ${totalPermissionCount()}`);
check('and nothing reports a gap when everything is granted',
  missingModules(everything).length === 0,
  missingModules(everything).map(m => m.key).join(', '));

// A role that went behind: everything a role could have held on the day the AI
// node did not yet exist. This is the role the clinic actually saved.
const roleFromBeforeAI = everything.filter(k => k !== 'AI');
check('a role that went behind reports the module it is missing',
  missingModules(roleFromBeforeAI).map(m => m.key).join(',') === 'AI',
  missingModules(roleFromBeforeAI).map(m => m.key).join(','));
check('and is not reported as complete',
  countGranted(roleFromBeforeAI) < totalPermissionCount());

// The trap itself, end to end: the same person, before and after.
const doc = user('PHYSICIAN');
const asCustom = { id: 'ROLE-X', name: 'Has all rights', description: '', permissions: roleFromBeforeAI, createdAt: '', createdBy: '' };

check('that doctor CAN see every department on their base role',
  canOpenMainNav(doc, 'ai') && missingModules(roleFromBeforeAI).length > 0);
check('but loses the AI Assistant once the custom role is assigned',
  !canOpenMainNav(doc, 'ai', asCustom));
check('and every other department is untouched, which is why it looks like a small problem',
  MAIN_NAV.filter(n => n.id !== 'ai').every(n => canOpenMainNav(doc, n.id, asCustom)),
  MAIN_NAV.filter(n => n.id !== 'ai' && !canOpenMainNav(doc, n.id, asCustom)).map(n => n.id).join(', '));
check('assigning the repaired role restores it',
  canOpenMainNav(doc, 'ai', { ...asCustom, permissions: grantEverything() }));

// "Everything" must also mean the same thing as an administrator's grants, or
// there would be two answers to one question.
check('granting everything is indistinguishable from an administrator',
  MAIN_NAV.every(n => canOpenMainNav(doc, n.id, { ...asCustom, permissions: everything })));
check('and it reaches every screen, not only every department door',
  Object.keys(SUB_NAV).every(nav => permittedSubNavs(doc, nav, { ...asCustom, permissions: everything })
    .length === (SUB_NAV[nav]?.items.length ?? 0)));

// ---------------------------------------------------------------------------
// The columns keep their labels and the body reaches the right-hand edge
// ---------------------------------------------------------------------------

section('the workspace columns keep their text and the body fills the screen');

// This is a source-level guard, not a render test, and the distinction matters.
// The defect it catches was found by measuring a real browser, not by reading
// the code: the submenu was `w-[20%]`, which resolved to 80px on a 892px window,
// so the labels were rendered and clipped to zero width - "icons with no text".
// Nothing about the JSX looks wrong. The body was `w-[70%]`, which with the
// submenu at 20% and the first column capped at 100px left a strip of empty
// background down the right of every screen.
//
// Percentages in a row of flex columns are the mistake, so that is what is
// forbidden here. What is NOT asserted is that the layout looks right - only a
// real browser can say that, and a check which claimed otherwise would be worse
// than none.

function readSrc(...parts) {
  return fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
}

// Strip comments: the reasoning above lives in the source and names the very
// classes it is checking for.
const layoutFiles = [
  ['src', 'components', 'layout', 'MainContainer.tsx'],
  ['src', 'components', 'layout', 'Sidebar1.tsx'],
  ['src', 'components', 'layout', 'Sidebar2.tsx'],
];

for (const rel of layoutFiles) {
  const code = readSrc(...rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  const pct = [...code.matchAll(/w-\[\d+(\.\d+)?%\]/g)].map(m => m[0]);
  check(`${rel[3]} gives its column a real width, not a percentage`,
    pct.length === 0, [...new Set(pct)].join(', '));
}

// The body takes exactly the space the two columns did not, which is `flex-1`,
// and is allowed to be squeezed below its content by `min-w-0`.
const mainCode = readSrc('src', 'components', 'layout', 'MainContainer.tsx')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const mainTags = [...mainCode.matchAll(/<main className="([^"]*)"/g)].map(m => m[1]);
check('the body is present on every screen it renders',
  mainTags.length > 0 && mainTags.every(c => /\bflex-1\b/.test(c) && /\bmin-w-0\b/.test(c)),
  mainTags.join(' | '));

// A label that is not in the markup cannot appear, and a column that clips is
// how it disappeared in the first place.
for (const [file, marker] of [['Sidebar1.tsx', 'item.label'], ['Sidebar2.tsx', 'item.label']]) {
  const code = readSrc('src', 'components', 'layout', file);
  check(`${file} still renders the menu text, not only the icon`,
    code.includes(marker));
  check(`${file} does not hide its labels`,
    !/hidden[^"'`]*>\{item\.label\}/.test(code));
}

// ---------------------------------------------------------------------------
// Nothing navigates to a destination the menu does not have
// ---------------------------------------------------------------------------

section('no screen is opened by a route the menu cannot get back out of');

/*
 * Removing Billing and Analytics from the first column left one loose end, and it
 * was found by clicking the dashboard's "Collected Revenue" card in a browser
 * rather than by reading anything: that card still navigated to `billing`, so the
 * Central Billing screen opened with NO row marked in the first column. The
 * person could still leave - clicking any row works - but for a moment the
 * application was showing a screen it could not account for.
 *
 * The fix is to route it through Front Desk, which renders the identical
 * component, so the screen the card opens is one the menu already knows about.
 * That is safe because the two routes are proven gated identically above.
 *
 * This check is the guard: it forbids the loose end rather than trusting the one
 * site that had it. `onNavigate` calls are read out of the source, so a card
 * added next month cannot reintroduce it silently.
 */

const outOfMenuIds = MAIN_NAV.filter(n => n.inMenu === false).map(n => n.id);
const mainContainerCode = readSrc('src', 'components', 'layout', 'MainContainer.tsx')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const routedIds = new Set(
  [...mainContainerCode.matchAll(/onNavigate\(\s*'([a-z_]+)'/g)].map(m => m[1]),
);
check('the application reads as navigating somewhere at all', routedIds.size > 0,
  `${routedIds.size} distinct destination(s) found`);

const unroutable = [...routedIds].filter(id => outOfMenuIds.includes(id));
check('nothing navigates to a destination that is not a menu row',
  unroutable.length === 0, unroutable.join(', '));

// The positive half: the billing card goes to Front Desk, which is a menu row.
check("the dashboard's billing card opens the billing screen through Front Desk",
  mainContainerCode.includes("onNavigate('patients', 'central_billing')"));
check("and it no longer opens it through the removed Billing column",
  !mainContainerCode.includes("onNavigate('billing'"));

// Analytics is a ROW IN THE DASHBOARD'S SUBMENU, not a route anybody calls. That
// is the whole reason it needs no second route: clicking it sets
// `activeNav = 'dashboard'`, so the first column keeps marking the place and the
// menu never disagrees with the screen. Checked as the submenu entry it is,
// rather than as an `onNavigate` call that never existed.
const analyticsRow = (SUB_NAV.dashboard?.items ?? []).find(i => i.id === 'analytics');
check('analytics is offered as a row inside the dashboard submenu',
  !!analyticsRow, analyticsRow?.label ?? 'absent from SUB_NAV.dashboard');

// And the component behind it is the same one the removed column rendered, which
// is what made the second entry a duplicate in the first place.
check('the dashboard renders AnalyticsDashboard for that row',
  /activeSubNav === 'analytics'/.test(mainContainerCode)
  && /return <AnalyticsDashboard \/>/.test(mainCode),
  'no AnalyticsDashboard for dashboard/analytics');


section('a date range covers exactly the days that were asked for');

// A fixed "now" so the suite does not fail at midnight on the first of the month.
// 2026-10-01 is a Thursday.
const NOW = new Date(2026, 9, 1, 14, 30, 0);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// "Today" must include a record saved at 00:01 this morning. Comparing against a
// window that ends at midnight would exclude it, and the total would be zero for
// a day in which work was done.
const today = buildWindow({ mode: 'today', now: NOW }).window;
check('Today includes a record saved at one minute past midnight this morning',
  withinWindow(`${iso(NOW)}T00:01:00.000Z`, today));
check('Today excludes yesterday evening',
  !withinWindow(`${iso(new Date(2026, 8, 30))}T23:00:00`, today));
check('Today excludes a bare date for yesterday',
  !withinWindow('2026-09-30', today));
check('Today includes a bare date for today',
  withinWindow('2026-10-01', today));

// A custom range ending on a day must include that whole day, not stop at its
// midnight - the mistake that drops everything the person asked to see.
const custom = buildWindow({ mode: 'custom', from: '2026-09-01', to: '2026-09-30' });
check('a custom range is accepted', custom.error === null, custom.error);
check('...and includes the first morning of the first day',
  withinWindow('2026-09-01T00:30:00', custom.window));
check('...and the last evening of the last day',
  withinWindow('2026-09-30T23:59:00', custom.window));
check('...and excludes the day before the start',
  !withinWindow('2026-08-31T23:59:00', custom.window));
check('...and excludes the day after the end',
  !withinWindow('2026-10-01T00:30:00', custom.window));

// One day is one day, not an empty range.
const single = buildWindow({ mode: 'custom', from: '2026-09-15', to: '2026-09-15' });
check('a range whose start equals its end is one day, not none',
  single.error === null && withinWindow('2026-09-15T14:00:00', single.window),
  single.error);

// Reversed ranges are refused out loud rather than silently showing nothing.
const reversed = buildWindow({ mode: 'custom', from: '2026-09-30', to: '2026-09-01' });
check('a reversed range is refused', reversed.window === null);
check('...and says what to do about it',
  /end date is before the start date/.test(reversed.error ?? ''), reversed.error);

const halfFilled = buildWindow({ mode: 'custom', from: '2026-09-01' });
check('a half-filled range is refused', halfFilled.window === null && !!halfFilled.error);

// This week starts on Monday. 2026-10-01 is a Thursday, so the week began the 28th
// of September. A window starting Sunday would drop two days of clinic.
const week = buildWindow({ mode: 'week', now: NOW }).window;
check('the week starts on Monday the 28th, not Sunday the 27th',
  iso(week.from) === '2026-09-28', iso(week.from));
check('the week includes Monday itself',
  withinWindow('2026-09-28T09:00:00', week));
check('the week excludes the Sunday before it',
  !withinWindow('2026-09-27T09:00:00', week));

const month = buildWindow({ mode: 'month', now: NOW }).window;
check('the month starts on the first', iso(month.from) === '2026-10-01', iso(month.from));
check('the month excludes the last day of September',
  !withinWindow('2026-09-30T12:00:00', month));

const year = buildWindow({ mode: 'year', now: NOW }).window;
check('the year starts on the first of January', iso(year.from) === '2026-01-01', iso(year.from));
check('the year includes last December... no: excludes it',
  !withinWindow('2025-12-31T12:00:00', year));
check('and includes this January',
  withinWindow('2026-01-15T12:00:00', year));

// All time really is all time, which is what the previous filter claimed to be
// while showing something else.
const all = buildWindow({ mode: 'all', now: NOW });
check('"all time" has no window at all', all.window === null && all.error === null);
check('and therefore includes every record, however old',
  withinWindow('1999-01-01', null) && withinWindow(`${iso(NOW)}T23:00:00`, null));

// Dates the application cannot read are reported rather than guessed at.
check('an unparseable date is not silently placed inside a window',
  !withinWindow('not-a-date', today));
check('a missing date is not silently placed inside a window',
  !withinWindow(undefined, today) && !withinWindow(null, today) && !withinWindow('', today));
check('a calendar date that does not exist is rejected, not rolled forward',
  parseStoredDate('2026-02-31') === null);
check('29 February of a leap year is accepted (2024 is a leap year)',
  parseStoredDate('2024-02-29') !== null);
check('29 February of a common year is rejected (2026 is not)',
  parseStoredDate('2026-02-29') === null);
check('unreadable dates are counted so the report can say so',
  countUnreadable(['2026-10-01', 'oops', '', null, undefined, '2026-09-30']) === 4);

// ---------------------------------------------------------------------------
// The clinical dashboard counts what its own label claims
// ---------------------------------------------------------------------------

section('the clinical dashboard counts the dates it says it counts');

/*
 * The Clinical Dashboard was hard-wired to today: every group was
 * `visitDate === today`, in a UTC string comparison, so at 00:30 local it showed
 * yesterday's flow while the header said today. It gained a date range, and the
 * arithmetic behind the cards moved into `clinicalFlow.ts` so it could be asked
 * about a specific day rather than only the day the suite happens to run.
 *
 * The trap these checks exist for is the obvious one: a filter that is displayed
 * and then not applied. So the assertions are about what is COUNTED under a
 * chosen range, not about whether a date box is present.
 */

// A small clinic, on known dates, with known states.
const V = (id, patientId, visitDate, status, extra = {}) => ({
  id, patientId, visitDate, visitTime: '09:00', visitType: 'Routine', status, ...extra,
});

const FLOW_VISITS = [
  V('v1', 'p1', '2026-09-28', 'Admitted', { ward: 'MALE' }),
  V('v2', 'p2', '2026-09-29', 'Admitted', { ward: 'FEMALE' }),
  V('v3', 'p3', '2026-09-30', 'Admitted', { ward: 'MALE' }),
  V('v4', 'p4', '2026-10-01', 'With Doctor'),
  V('v5', 'p5', '2026-10-01', 'Awaiting Vitals'),
  V('v6', 'p6', '2026-10-01', 'Awaiting Lab'),
  V('v7', 'p7', '2026-09-25', 'Discharged'),
  V('v8', 'p8', '2026-10-01', 'Discharged'),
];

const todayCounts = clinicalGroupCounts(FLOW_VISITS, today);
check('today excludes an encounter from yesterday', todayCounts.discharged === 1,
  `discharged=${todayCounts.discharged}`);
check('today includes an encounter from today', todayCounts.doctor === 1,
  `doctor=${todayCounts.doctor}`);
check('today counts the three separate queues correctly',
  todayCounts.triage === 1 && todayCounts.lab === 1, JSON.stringify(todayCounts));

// September. The queue cards must move; that is the whole point of the control.
const september = buildWindow({ mode: 'custom', from: '2026-09-01', to: '2026-09-30' }).window;
const septCounts = clinicalGroupCounts(FLOW_VISITS, september);
check('a September range excludes today\'s encounters', septCounts.doctor === 0,
  `doctor=${septCounts.doctor}`);
check('a September range includes September\'s encounters', septCounts.discharged === 1,
  `discharged=${septCounts.discharged}`);

// The month-to-date preset must agree with what a person means by it.
const octCounts = clinicalGroupCounts(FLOW_VISITS, month);
check('"this month" agrees with an explicit October range',
  JSON.stringify(octCounts) === JSON.stringify(
    clinicalGroupCounts(FLOW_VISITS, buildWindow({ mode: 'custom', from: '2026-10-01', to: '2026-10-01' }).window),
  ), JSON.stringify(octCounts));

// A range covering both months includes both, and is not the sum of nothing.
const both = buildWindow({ mode: 'custom', from: '2026-09-25', to: '2026-10-01' }).window;
check('a range spanning the month boundary includes encounters from both sides',
  clinicalGroupCounts(FLOW_VISITS, both).discharged === 2,
  JSON.stringify(clinicalGroupCounts(FLOW_VISITS, both)));

// All time is the widest thing on offer, and it is genuinely wider than a year.
const allTimeCounts = clinicalGroupCounts(FLOW_VISITS, null);
check('all time includes every encounter, on any date', allTimeCounts.discharged === 2);
check('...and it is wider than this month',
  allTimeCounts.discharged > octCounts.discharged);

// ---------------------------------------------------------------------------
// The ward census ignores the range, and that is deliberate
// ---------------------------------------------------------------------------

/*
 * A patient admitted on Tuesday is still in a bed on Thursday. Narrowing the ward
 * census by a date range would report an empty ward while patients are lying in
 * it, and anyone believing that number could stop looking for them. So the census
 * is exempt, and the exemption is asserted here rather than trusted to a comment.
 */

check('the ward census counts everyone in a ward on any date, whatever the range',
  todayCounts.admitted === 3 && septCounts.admitted === 3 && allTimeCounts.admitted === 3,
  `today=${todayCounts.admitted} sept=${septCounts.admitted} all=${allTimeCounts.admitted}`);
check('the census is the only group exempt from the range',
  CLINICAL_FLOW_GROUPS.filter(g => !g.followsRange).map(g => g.id).join(',') === WARD_CENSUS_GROUP_ID,
  CLINICAL_FLOW_GROUPS.filter(g => !g.followsRange).map(g => g.id).join(','));
check('every other group does follow the range',
  RANGED_FLOW_GROUPS.length === CLINICAL_FLOW_GROUPS.length - 1);

// Ward narrowing must still work, and must not leak into the queues.
check('narrowing the census to a ward gives that ward only',
  clinicalGroupPatientIds(FLOW_VISITS, 'admitted', september, 'MALE').size === 2);
check('narrowing the census to a ward keeps ignoring the date range',
  clinicalGroupPatientIds(FLOW_VISITS, 'admitted', today, 'MALE').size === 2,
  'a ward must not empty out because the range is today');
check('a ward name that is not there gives nobody, not everybody',
  clinicalGroupPatientIds(FLOW_VISITS, 'admitted', null, 'PAEDIATRIC').size === 0);

// A patient with no ward is counted, under UNSPECIFIED, rather than vanishing.
// A census that does not add up to the admitted count is worse than no census.
const noWard = [...FLOW_VISITS, V('v9', 'p9', '2026-10-01', 'Admitted')];
check('an admitted patient with no ward is still counted',
  clinicalGroupCounts(noWard, null).admitted === 4);
check('...and appears in the census as UNSPECIFIED',
  admittedByWard(noWard).some(w => w.ward === 'UNSPECIFIED' && w.count === 1),
  JSON.stringify(admittedByWard(noWard)));

// The ward breakdown must add up to the admitted card. If these two ever
// disagree, one of them is lying about how many people are in the building.
const censusSum = admittedByWard(FLOW_VISITS).reduce((s, w) => s + w.count, 0);
check('the ward breakdown adds up to the admitted count',
  censusSum === clinicalGroupCounts(FLOW_VISITS, null).admitted,
  `${censusSum} vs ${clinicalGroupCounts(FLOW_VISITS, null).admitted}`);

// Ward narrowing applies to the census only. A doctor-queue visit has no ward, so
// applying it there would hide every one of them.
const doctorGroup = findFlowGroup('doctor');
check('a ward filter does not hide the doctor queue',
  FLOW_VISITS.filter(v => visitInGroup(v, doctorGroup, today, 'MALE')).length === 1);

// ---------------------------------------------------------------------------
// Counting patients, not rows
// ---------------------------------------------------------------------------

// One patient with two encounters in the same state is one card, not two.
const dupes = [
  V('d1', 'same', '2026-10-01', 'With Doctor'),
  V('d2', 'same', '2026-10-01', 'With Doctor'),
  V('d3', 'other', '2026-10-01', 'With Doctor'),
];
check('one patient with two encounters in a state counts once',
  clinicalGroupCounts(dupes, today).doctor === 2,
  `doctor=${clinicalGroupCounts(dupes, today).doctor}`);

// The three terminal statuses are one question, not three.
check('treated, discharged and completed all count as discharged',
  clinicalGroupCounts([
    V('t1', 'a', '2026-10-01', 'Treated'),
    V('t2', 'b', '2026-10-01', 'Discharged'),
    V('t3', 'c', '2026-10-01', 'Completed'),
  ], today).discharged === 3);

// 'Awaiting Physician' and 'With Doctor' are both the doctor queue.
check('awaiting physician and with doctor are one queue',
  clinicalGroupCounts([
    V('w1', 'a', '2026-10-01', 'Awaiting Physician'),
    V('w2', 'b', '2026-10-01', 'With Doctor'),
  ], today).doctor === 2);

// An unreadable date falls out of every range rather than being guessed into one.
const broken = [
  V('b1', 'good', '2026-10-01', 'With Doctor'),
  V('b2', 'bad', 'not-a-date', 'With Doctor'),
  V('b3', 'bad2', '', 'With Doctor'),
];
check('an encounter with an unreadable date is counted in no range',
  clinicalGroupCounts(broken, today).doctor === 1,
  `doctor=${clinicalGroupCounts(broken, today).doctor}`);
// The screen used to report how many dates it had dropped. That note was asked to
// be removed, so there is no tally in the component any more - but the refusal is
// the part that matters and it is still asserted here, so it cannot be quietly
// relaxed into a guess.
check('...and "all time", which imposes no restriction, still shows them',
  clinicalGroupCounts(broken, null).doctor === 3,
  `doctor=${clinicalGroupCounts(broken, null).doctor}`);

// A group id nobody defined gives nobody, not everybody.
check('an unknown group id counts nobody',
  clinicalGroupPatientIds(FLOW_VISITS, 'no-such-group', null).size === 0);

// The local-time boundary. `visitDate` is a bare date, so a UTC comparison would
// misplace an early-morning encounter the day a timezone changes.
check('a bare encounter date is read in local time, not UTC',
  withinWindow('2026-10-01', buildWindow({ mode: 'custom', from: '2026-10-01', to: '2026-10-01', now: NOW }).window));

// A range that ends on a day includes that whole day for the cards too.
const oneDay = buildWindow({ mode: 'custom', from: '2026-10-01', to: '2026-10-01' }).window;
check('a single-day range still counts that day\'s queue',
  clinicalGroupCounts(FLOW_VISITS, oneDay).doctor === 1);
check('...and does not reach back into the month before',
  clinicalGroupCounts(FLOW_VISITS, oneDay).discharged === 1);

// The card and the list below it must be computed from ONE window. Both call the
// same function; this asserts they agree for a range that is not today, which is
// the case that would expose a page still defaulting to today.
const cardCount = clinicalGroupCounts(FLOW_VISITS, september).discharged;
const listCount = clinicalGroupPatientIds(FLOW_VISITS, 'discharged', september).size;
check('a card and the list under it agree for a range that is not today',
  cardCount === listCount, `${cardCount} vs ${listCount}`);

// ---------------------------------------------------------------------------
// The screen names what it counted
// ---------------------------------------------------------------------------

const clinicalDashboardSrc = readSrc('src', 'components', 'clinical', 'ClinicalDashboard.tsx');
const clinicalPageSrc = readSrc('src', 'components', 'clinical', 'ClinicalDashboardPage.tsx');
const clinicalCode = clinicalDashboardSrc.replace(/\/\*[\s\S]*?\*\//g, ' ');

/*
 * A number without a range beside it is the bug this whole module exists to
 * avoid, so the words are checked too. Not the styling - whether the date boxes
 * are on screen is a browser's question. But whether the header names the range
 * is a fact about the source, and it is the fact that stops "This month" becoming
 * a caption on top of all-time numbers.
 */
/*
 * Matched on the header line itself, not on `describeWindow` appearing somewhere
 * in the file. A looser check passed while the header read a hardcoded "Today",
 * because the range bar underneath still called describeWindow - which is exactly
 * the shape of this bug: the word is present, and it is on the wrong element.
 */
check('the header names the range rather than always saying today',
  clinicalCode.includes('Doctor &amp; Nursing flow • {describeWindow(win)}')
  && !clinicalCode.includes('const todayLabel'));
check('the dashboard does not compute its own notion of today',
  !/toISOString\(\)\.split\('T'\)\[0\]/.test(clinicalDashboardSrc),
  'a UTC string comparison would misplace an early-morning encounter');
check('the date range is offered as presets and as a picked range',
  clinicalCode.includes("RANGE_PRESETS") && clinicalCode.includes('type="date"'));
check('the list under the cards is filtered by the same window',
  clinicalPageSrc.includes('clinicalGroupPatientIds(visits, groupDef.id, window, ward)'),
  'the page must pass the window, not fall back to today');
check('the list names its range too, so a short list is not read as a bug',
  clinicalPageSrc.includes('describeWindow(window)'));
check('the number of wards in flow adds up to something the range can change',
  clinicalCode.includes('RANGED_FLOW_GROUPS'), 'flowTotal must exclude the census');

/*
 * The explanatory note under the date filter was asked to be removed. Two facts it
 * carried therefore have to survive in a shorter form, or a person is left
 * guessing: which range the cards count, and that the ward census ignores it.
 *
 * These checks do not require prose - they require the signal. The cards caption
 * themselves, and the census carries its own badge. If someone strips those
 * instead, the counts stop saying what they are and these fail.
 */
check('every flow card says which range it counted, without being told in prose',
  clinicalCode.includes('"Today\'s flow"') && clinicalCode.includes("? 'Any date'")
  && clinicalCode.includes(": 'Dated in range'"));
check('the ward census still declares that it is not limited by the range',
  clinicalCode.includes('wardCensusIgnoresRange') && clinicalCode.includes('all dates'),
  'the census exemption needs a signal on screen, not only a comment');

/*
 * "All time" builds to a NULL window - no restriction at all. So asking the
 * window "is this today?" answers YES for All time, and the screen said
 * "Encounters dated today" with "Today's flow" under every card while counting
 * every encounter ever saved. That is exactly the caption-over-all-time-numbers
 * fault `dateRange.ts` exists to prevent, reintroduced by reading "no window" as
 * "a window for one day". So the wording is keyed on the chosen mode, not the
 * window.
 */
check('the wording is keyed on the chosen range, not on the window being absent',
  clinicalCode.includes('const showingToday = mode ===')
  && clinicalCode.includes('const showingAllTime = mode ==='),
  'a null window must not be read as today');
check('"all time" is captioned as any date rather than today\'s flow',
  clinicalCode.includes("? 'Any date'") && !/"Any date"[^\n]*\n\s*: "Today's flow"/.test(clinicalCode));


// A bare date means that whole day, in the viewer's own timezone. Comparing the
// raw string would move a morning's clinic into yesterday for anybody west of UTC.
const westOfUtc = new Date('2026-10-01T08:00:00'); // stored 08:00 local
check('a bare date is read as a whole local day',
  iso(parseStoredDate('2026-10-01')) === '2026-10-01');
check('and its local midnight is local midnight, not UTC midnight',
  parseStoredDate('2026-10-01').getHours() === 0);
check('a timestamped record keeps its time of day',
  parseStoredDate('2026-10-01T14:45:00').getHours() === 14);

check('the screen is told which range it is showing', describeWindow(month) === 'This month');
check('and an all-time report says so rather than saying nothing', describeWindow(null) === 'All time');
check('and a custom range is named', /2026-09-01 to 2026-09-30/.test(describeWindow(custom.window)));

// ---------------------------------------------------------------------------
// The signed-out visitor gets a page, not a crash
// ---------------------------------------------------------------------------


section('a signed-out visitor gets a page, not a crash');

// This section guards a bug that shipped: `/staff` rendered blank for everybody,
// because `App` calls `useAccess()` above its own signed-out gate and that hook
// used `useCurrentUser()`, which throws when nobody is signed in. The throw
// happened during the render whose job is to show the sign-in card, React
// unmounted the tree, and there was no way to sign in at all. It passed `tsc`,
// passed the build, and passed every other check, because the landing page is
// rendered by a different component and looked perfectly fine.

const signedOut = denyAllAccess();

check('a signed-out visitor has no user', signedOut.user === null);
check('and nothing is openable',
  MAIN_NAV.every(n => !signedOut.canOpenMainNav(n.id)),
  MAIN_NAV.filter(n => signedOut.canOpenMainNav(n.id)).map(n => n.id).join(', '));
check('and no screen inside any department is openable',
  Object.keys(SUB_NAV).every(nav => signedOut.permittedSubNavs(nav).length === 0));
check('and no menu at all is offered', signedOut.permittedMainNavs().length === 0);
check('and no money', signedOut.canSeeRevenue() === false);
check('and a navigation goes nowhere, without throwing',
  signedOut.resolveRoute('laboratory', 'hematology').nav === null);
check('and it says why in words rather than crashing',
  signedOut.deniedReason('laboratory', 'hematology') === 'Nobody is signed in.');

// Deny-all must be total, not partial: every entry point answered, and none of
// them raises whatever arguments it is handed.
let signedOutThrew = null;
try {
  signedOut.canSeeRevenue();
  signedOut.canOpenMainNav('laboratory');
  signedOut.canOpenSubNav('laboratory', 'hematology');
  signedOut.permittedMainNavs();
  signedOut.permittedSubNavs('laboratory');
  signedOut.resolveRoute('admin', 'users_mgmt');
  signedOut.deniedReason('admin', 'users_mgmt');
} catch (err) {
  signedOutThrew = err.message;
}
check('none of the signed-out answers throws, whatever it is asked', signedOutThrew === null, signedOutThrew);

// `accessFor(null, ...)` must be the same answer, since that is the path the hook
// actually takes. If it ever diverged from `denyAllAccess`, the thing under test
// and the thing in use would be two different functions.
const viaAccessFor = accessFor(null, () => undefined);
check('accessFor(null) agrees with denyAllAccess about every answer',
  viaAccessFor.canOpenMainNav('laboratory') === signedOut.canOpenMainNav('laboratory')
  && viaAccessFor.permittedMainNavs().length === signedOut.permittedMainNavs().length
  && viaAccessFor.canSeeRevenue() === signedOut.canSeeRevenue());

// ...and a signed-in person still gets their own answers from the same function,
// so the signed-out path is a branch, not a replacement of the real thing.
const adminViaAccessFor = accessFor(user('ADMINISTRATOR'), () => undefined);
check('accessFor still answers for somebody who IS signed in',
  adminViaAccessFor.canOpenMainNav('admin') && adminViaAccessFor.user !== null);

// The static half. Nothing App renders above its signed-out gate may raise, and
// the hook that supplies those answers is the only place that could.
//
// Comments are stripped first, and that matters: the fix for this bug is a
// comment explaining WHY `useCurrentUser` must not be called here, which means
// the file names the very thing the check forbids. A check that read prose would
// fail on the explanation and pass on the bug.
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const hookSrc = codeOnly(fs.readFileSync(path.join(ROOT, 'src', 'hooks', 'useAccess.ts'), 'utf8'));
check('useAccess does not call the hook that throws while signed out',
  !/useCurrentUser\s*\(/.test(hookSrc),
  'useAccess is called by App above the signed-out gate; a throw there unmounts the tree and /staff renders blank');
check('useAccess does not import it either',
  !/import[^;]*useCurrentUser/.test(hookSrc));

const appSrc = codeOnly(fs.readFileSync(path.join(ROOT, 'src', 'App.tsx'), 'utf8'));
const gateAt = appSrc.indexOf('if (isResolvingSession)');
check('App still gates on the session before rendering any clinical screen', gateAt > 0);
const preGate = appSrc.slice(0, gateAt > 0 ? gateAt : appSrc.length);
const preGateHooks = [...preGate.matchAll(/\b(use[A-Z]\w*)\s*\(/g)].map(m => m[1]);
check('nothing App calls above its gate can raise on a signed-out visitor',
  !preGateHooks.includes('useCurrentUser'),
  `above the gate App calls: ${[...new Set(preGateHooks)].join(', ')}`);

// ---------------------------------------------------------------------------
// Typeahead: the suggestion you most likely meant comes first
// ---------------------------------------------------------------------------

section('searching finds the thing that was meant, not just the first thing that matches');

const DRUGS = [
  { value: '1', label: 'Amoxicillin (500mg)', secondary: '₦2,000 • Stock 240' },
  { value: '2', label: 'Amoxicillin (250mg)', secondary: '₦1,400 • Stock 12' },
  { value: '3', label: 'Amoxicillin/Clavulanic Acid (625mg)', secondary: '₦3,100 • Stock 8' },
  { value: '4', label: 'Erythromycin (500mg)', secondary: '₦900 • Stock 60' },
  { value: '5', label: 'Ibuprofen (400mg)', secondary: '₦450 • Stock 300' },
  { value: '6', label: 'Ferrous Sulphate (200mg)', secondary: '₦300 • Stock 5' },
  // "sul" now reaches two of these: once at the start of a word, once inside one.
  // "Bisulolol" sorts before "Ferrous" alphabetically, so with the word-start rule
  // gone, alphabetical order alone would put the wrong one first - which is what
  // makes this fixture able to notice anything.
  { value: '7', label: 'Bisulolol (5mg)', secondary: '₦600 • Stock 40' },
];

// "amo" reaches exactly the three amoxicillins. It does NOT reach Ibuprofen,
// Erythromycin or Ferrous Sulphate, so anything extra in the list is a filtering
// bug. Note that "amo" is a substring of "Paracetamol" (par-a-**c-e-t-a-m-o**-l),
// which is why this fixture avoids it: a name that contains the letters is
// correctly a match, and using it here would have tested nothing.
const amo = filterAndRank(DRUGS, 'amo');
check('a prefix finds exactly the medicines that contain it', amo.length === 3, amo.map(o => o.label).join(' | '));
check('and every one of them is an amoxicillin',
  amo.every(o => o.label.toLowerCase().startsWith('amoxicillin')),
  amo.map(o => o.label).join(' | '));
check('the combination sorts after the plain formulations, deterministically',
  amo[2].label === 'Amoxicillin/Clavulanic Acid (625mg)', amo.map(o => o.label).join(' | '));
check('and the plain ones keep a stable, alphabetical order between them',
  amo.slice(0, 2).map(o => o.label).join(' | ') === 'Amoxicillin (250mg) | Amoxicillin (500mg)',
  amo.slice(0, 2).map(o => o.label).join(' | '));
check('an exact prefix outranks a mid-word match',
  rankMatch(DRUGS[0], 'amox') < rankMatch(DRUGS[2], 'acid'));

// A word-start match must outrank a match buried mid-word, so searching "sul"
// puts Ferrous Sulphate above anything that merely contains those letters.
const paraRanked = rankOptions(DRUGS, 'sul');
check('a word-start match outranks a mid-word match',
  paraRanked[0].label === 'Ferrous Sulphate (200mg)', paraRanked.map(o => `${o.label}=${o.rank}`).join(' | '));
check('a mid-word match is still found at all',
  rankMatch({ value: 'x', label: 'Hydroxychloroquine (200mg)' }, 'chloro') !== null);

// Someone who knows the strength and not the brand can still find the medicine.
check('the right-hand detail is searched too',
  rankMatch({ value: '7', label: 'Ibuprofen', secondary: '400mg • Stock 30' }, '400mg') !== null);
check('and it is found through the shared component, not a special case',
  filterAndRank([{ value: '7', label: 'Ibuprofen', secondary: '400mg • Stock 30' }], '400mg').length === 1);

// Nothing matching must produce nothing, so the caller can say so rather than
// showing a list that silently excludes what was searched for.
check('a query that matches nothing returns nothing', filterAndRank(DRUGS, 'zzzz').length === 0);
check('an empty query shows everything', filterAndRank(DRUGS, '').length === DRUGS.length);
check('whitespace alone is treated as no query, not as a query for spaces',
  filterAndRank(DRUGS, '   ').length === DRUGS.length);

// Case must not matter, or "AMOX" finds nothing in a list of Title Case names.
check('the search ignores case', filterAndRank(DRUGS, 'AMOXICILLIN').length === 3);
check('...and mixed case', filterAndRank(DRUGS, 'amOxIcIlLiN').length === 3);

// The list is bounded, because the longest one is a whole formulary.
const huge = Array.from({ length: 900 }, (_, i) => ({ value: String(i), label: `Medicine ${i}` }));
check('a long list is capped rather than rendered whole',
  filterAndRank(huge, 'medicine').length === 60, `${filterAndRank(huge, 'medicine').length} rendered`);

// The highlight must be a substring of the real label, never a rewrite of it.
const span = matchSpan('Amoxicillin/Clavulanic Acid (625mg)', 'clav');
check('the highlighted text is exactly the substring that was matched',
  span && span.before + span.hit + span.after === 'Amoxicillin/Clavulanic Acid (625mg)',
  JSON.stringify(span));
check('the highlight is the label\'s own casing, not what was typed',
  // This is the point: matching ignores case, but the text that ends up in the
  // field and in the record is the real name from the list, never the query.
  matchSpan('Amoxicillin (500mg)', 'AMOX')?.hit === 'Amox',
  JSON.stringify(matchSpan('Amoxicillin (500mg)', 'AMOX')));
check('a label with no match has no highlight, and says so by returning null',
  matchSpan('Ibuprofen', 'zzz') === null);

// ---------------------------------------------------------------------------

console.log('');
if (failures) {
  console.log(`[access self-test] ${failures} of ${checks} checks FAILED`);
  process.exitCode = 1;
} else {
  console.log(`[access self-test] all ${checks} checks behaved as expected`);
}
