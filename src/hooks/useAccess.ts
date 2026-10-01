/**
 * The signed-in person's grants, resolved once per render.
 *
 * `customRole` is looked up rather than passed around because getting that
 * lookup wrong is silent: a `CustomRole | undefined` that is `undefined` when the
 * user does have one grants the BASE role instead, which for an administrator
 * testing somebody else's account is the difference between "can see the menu"
 * and "cannot", with no error anywhere. One place to look it up, one place to
 * get it wrong.
 */
import { useMemo } from 'react';
import { db } from '../services/db';
import { useCurrentUser } from '../context/AuthContext';
import {
  canOpenMainNav, canOpenSubNav, canSeeRevenue, permittedMainNavs, permittedSubNavs,
  resolveRoute, deniedReason,
} from '../services/accessControl';
import type { MainNavId, SubNavId } from '../components/layout/navModel';
import type { User } from '../types';

export function useAccess() {
  const currentUser = useCurrentUser();
  const user = currentUser as User | null;

  return useMemo(() => {
    const customRole = user?.customRoleId ? db.getCustomRoleById(user.customRoleId) : undefined;

    if (!user) {
      // No signed-in person: nothing is visible and nothing is openable. Every
      // predicate below answers false rather than throwing, so a screen rendered
      // during sign-out shows an empty shell instead of crashing.
      const denyAll = () => false;
      return {
        user: null,
        customRole: undefined,
        canSeeRevenue: () => false,
        canOpenMainNav: denyAll as (nav: MainNavId) => boolean,
        canOpenSubNav: denyAll as (nav: MainNavId, sub: SubNavId) => boolean,
        permittedMainNavs: () => [],
        permittedSubNavs: () => [],
        resolveRoute: () => ({ nav: null, sub: null, refused: null, redirected: false }),
        deniedReason: () => 'Nobody is signed in.',
      };
    }

    return {
      user,
      customRole,
      canSeeRevenue: () => canSeeRevenue(user, customRole),
      canOpenMainNav: (nav: MainNavId) => canOpenMainNav(user, nav, customRole),
      canOpenSubNav: (nav: MainNavId, sub: SubNavId) => canOpenSubNav(user, nav, sub, customRole),
      permittedMainNavs: () => permittedMainNavs(user, customRole),
      permittedSubNavs: (nav: MainNavId) => permittedSubNavs(user, nav, customRole),
      resolveRoute: (nav: MainNavId, sub: SubNavId) => resolveRoute(user, customRole, nav, sub),
      deniedReason: (nav: MainNavId, sub: SubNavId) => deniedReason(user, nav, sub, customRole),
    };
  }, [user, user?.customRoleId]);
}