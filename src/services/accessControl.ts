/**
 * Who may see and open what, and what happens when they try anyway.
 *
 * WHY HIDING A MENU ITEM IS NOT ENOUGH
 * ------------------------------------
 * The request behind this was "a lab scientist must not be able to get to
 * Pharmacy, no matter how they manoeuvre their way". That phrase is the whole
 * specification, and it rules out the usual implementation. Not rendering a menu
 * item stops a person clicking it. It does not stop them:
 *
 *   - calling `onNavigate('pharmacy', 'rx_queue')` from a button on another screen,
 *   - holding the app open from a session signed in before a role change,
 *   - a stale tab that never reloaded after their permissions were cut,
 *   - a future screen whose author forgot the item was hidden.
 *
 * So a destination is only shown to somebody who may open it, AND opening it is
 * checked again at the point of navigation, AND the screen itself refuses to
 * render for anybody who may not open it. Three checks, because each covers a
 * failure the others do not: hiding covers the menu, the guard covers navigation,
 * and the render check covers every remaining path into the component including
 * the ones nobody has written yet.
 *
 * This module is deliberately free of React so the self-test can import the real
 * thing and check it against the real permission tree.
 */
import type { CustomRole, User } from '../types';
import { effectivePermissions, isEffectivelyGranted } from './permissions';
import {
  ADMIN_KEYS, BILLING_KEYS, LAB_VIEW_KEYS, MAIN_NAV, SUB_NAV, allSubNavItems,
  type MainNavId, type MainNavItem, type SubNavId, type SubNavItem,
} from '../components/layout/navModel';

// ---------------------------------------------------------------------------
// Revenue: a question about who someone is, not about a ticked box
// ---------------------------------------------------------------------------

/**
 * The roles that may see money anywhere in the system.
 *
 * `BILLING_OFFICER` is here deliberately. Revenue and billing were restricted to
 * Administrator and Front Desk; a billing officer whose entire job is billing
 * would have signed in to an empty application, so the role is included. Every
 * clinical role - physician, nurse, laboratory, pharmacy, radiology,
 * physiotherapy - is excluded, which is the part that was asked for. A doctor
 * holds `BILLING.INVOICES` in the base role for the invoice numbers on their own
 * orders, and that is exactly why the gate below cannot be a permission check
 * alone: the permission is present and the money must still be refused.
 */
export const REVENUE_ROLES: readonly string[] = ['ADMINISTRATOR', 'FRONT_DESK', 'BILLING_OFFICER'];

/**
 * Whether this person may see revenue figures, invoice amounts, or cashier takings.
 *
 * A custom role is judged by what it grants rather than by the base role it sits
 * on: an administrator who builds a role with `BILLING.INVOICES` has decided that
 * role handles money, and hiding the revenue card from it while showing it the
 * invoices would be incoherent in the other direction.
 */
export function canSeeRevenue(user: User, customRole?: CustomRole): boolean {
  if (user.role === 'ADMINISTRATOR') return true;
  if (customRole) {
    return BILLING_KEYS.some(k => isEffectivelyGranted(customRole.permissions, k));
  }
  return REVENUE_ROLES.includes(user.role);
}

// ---------------------------------------------------------------------------
// The two predicates everything else is built from
// ---------------------------------------------------------------------------

function grantedAnyOf(user: User, keys: readonly string[], customRole?: CustomRole): boolean {
  if (keys.length === 0) return false;
  if (user.role === 'ADMINISTRATOR') return true;
  const held = customRole ? customRole.permissions : effectivePermissions(user);
  return keys.some(k => isEffectivelyGranted(held, k));
}

/** Whether the main menu entry for `nav` is this person's to see. */
export function canOpenMainNav(user: User, nav: MainNavId, customRole?: CustomRole): boolean {
  const item = MAIN_NAV.find(n => n.id === nav);
  if (!item) return false;
  if (item.revenue && !canSeeRevenue(user, customRole)) return false;
  return grantedAnyOf(user, item.anyOf, customRole);
}

/** Whether the submenu entry `sub` inside `nav` is this person's to see. */
export function canOpenSubNav(user: User, nav: MainNavId, sub: SubNavId, customRole?: CustomRole): boolean {
  const item = allSubNavItems(nav).find(i => i.id === sub);
  // An id that is not in the submenu is refused rather than allowed through.
  // Failing open here would make any unrecognised id a way in, which is precisely
  // the "no matter how they manoeuvre their way" case: an unrecognised id does
  // not reach a screen, but it must not be treated as permission either.
  if (!item) return false;
  if (item.revenue && !canSeeRevenue(user, customRole)) return false;
  return grantedAnyOf(user, item.anyOf, customRole);
}

// ---------------------------------------------------------------------------
// The filtered menus
// ---------------------------------------------------------------------------

export function permittedMainNavs(user: User, customRole?: CustomRole): MainNavItem[] {
  return MAIN_NAV.filter(n => canOpenMainNav(user, n.id, customRole));
}

/**
 * The submenu for `nav`, with anything this person may not open removed.
 *
 * A parent whose every child is hidden is itself removed, so a menu never offers
 * a row that expands into nothing.
 */
export function permittedSubNavs(user: User, nav: MainNavId, customRole?: CustomRole): SubNavItem[] {
  const group = SUB_NAV[nav];
  if (!group) return [];
  if (!canOpenMainNav(user, nav, customRole)) return [];

  const filter = (items: SubNavItem[]): SubNavItem[] =>
    items.flatMap(item => {
      if (!canOpenSubNav(user, nav, item.id, customRole)) return [];
      if (!item.subItems) return [item];
      const kids = filter(item.subItems);
      // Keep the parent only if it still leads somewhere this person may go.
      return kids.length > 0 ? [{ ...item, subItems: kids }] : [];
    });

  return filter(group.items);
}

/** The first destination this person may open, which is where they land. */
export function firstPermittedNav(user: User, customRole?: CustomRole): MainNavId | null {
  return permittedMainNavs(user, customRole)[0]?.id ?? null;
}

/** The first screen inside `nav` this person may open. */
export function firstPermittedSub(user: User, nav: MainNavId, customRole?: CustomRole): SubNavId | null {
  return permittedSubNavs(user, nav, customRole)[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Navigation that cannot be talked out of
// ---------------------------------------------------------------------------

export interface RouteDecision {
  nav: MainNavId | null;
  sub: SubNavId | null;
  /** Set when the requested destination was refused, with the reason in words. */
  refused: string | null;
  /** True when the refusal moved the user somewhere else. */
  redirected: boolean;
}

/**
 * Decide where a navigation request may actually land.
 *
 * The rule is "fall back to the first thing you may see, and say so". Falling
 * back is better than refusing outright because the alternative to a usable
 * screen is a blank one, and a person who clicked a link that quietly does
 * nothing will click it again; a person who lands on their own dashboard with an
 * explanation will not.
 */
export function resolveRoute(
  user: User,
  customRole: CustomRole | undefined,
  requestedNav: MainNavId,
  requestedSub: SubNavId,
): RouteDecision {
  const navAllowed = canOpenMainNav(user, requestedNav, customRole);

  if (!navAllowed) {
    const nav = firstPermittedNav(user, customRole);
    return {
      nav,
      sub: nav ? firstPermittedSub(user, nav, customRole) : null,
      refused: deniedReason(user, requestedNav, requestedSub, customRole),
      redirected: true,
    };
  }

  if (canOpenSubNav(user, requestedNav, requestedSub, customRole)) {
    return { nav: requestedNav, sub: requestedSub, refused: null, redirected: false };
  }

  const sub = firstPermittedSub(user, requestedNav, customRole);
  return {
    nav: requestedNav,
    sub,
    refused: deniedReason(user, requestedNav, requestedSub, customRole),
    redirected: true,
  };
}

/** An honest sentence about why a destination was refused. */
export function deniedReason(
  user: User,
  nav: MainNavId,
  sub: SubNavId,
  customRole?: CustomRole,
): string {
  const navItem = MAIN_NAV.find(n => n.id === nav);
  const subItem = allSubNavItems(nav).find(i => i.id === sub);
  const what = subItem?.label ?? navItem?.label ?? 'That screen';
  const where = subItem ? navItem?.label ?? nav : '';

  if (subItem?.revenue && !canSeeRevenue(user, customRole)) {
    return (
      `${what} shows what the clinic earns and what patients owe, which is limited to ` +
      `Administrator, Front Desk and Billing Officer. Your role is ${roleLabel(user)}.`
    );
  }
  if (navItem?.revenue && !canSeeRevenue(user, customRole)) {
    return (
      `${where ? `${where} shows` : 'That area shows'} what the clinic earns and what patients owe, ` +
      `which is limited to Administrator, Front Desk and Billing Officer. ` +
      `Your role is ${roleLabel(user)}.`
    );
  }
  if (!subItem) {
    return `${where || 'That area'} has no screen called "${sub}", and your role is ${roleLabel(user)}.`;
  }
  return (
    `${what} is not part of ${roleLabel(user)}'s access. An administrator can grant it ` +
    `under Roles & Permissions.`
  );
}

/** A role in words, so a refusal explains itself without a lookup table. */
export function roleLabel(user: User): string {
  const labels: Record<string, string> = {
    ADMINISTRATOR: 'Administrator',
    PHYSICIAN: 'Doctor',
    NURSE: 'Nurse',
    LAB_SCIENTIST: 'Laboratory Scientist',
    PHARMACIST: 'Pharmacist',
    RADIOLOGIST: 'Radiologist',
    PHYSIOTHERAPIST: 'Physiotherapist',
    FRONT_DESK: 'Front Desk',
    BILLING_OFFICER: 'Billing Officer',
  };
  return labels[user.role] ?? user.role;
}

/**
 * Every destination this person may not open.
 *
 * Used by the self-test to assert the opposite of what it asserts everywhere
 * else: that for every role, the set of hidden destinations is exactly the set
 * the base permissions do not grant - so a new menu item cannot appear for
 * everyone by accident.
 */
export function refusedMainNavs(user: User, customRole?: CustomRole): MainNavId[] {
  return MAIN_NAV.filter(n => !canOpenMainNav(user, n.id, customRole)).map(n => n.id);
}

export { MAIN_NAV, SUB_NAV, allSubNavItems, ADMIN_KEYS, BILLING_KEYS, LAB_VIEW_KEYS };