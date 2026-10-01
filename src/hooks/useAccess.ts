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
// `useAuth`, deliberately NOT `useCurrentUser`.
//
// `useCurrentUser()` throws when nobody is signed in, which is right for a
// clinical screen that App already refuses to render without a session. But App
// calls this hook at the top of its own component, ABOVE the signed-out gate,
// because `goTo` needs the answers. So `useCurrentUser()` here threw during the
// render that exists precisely to show the sign-in card, React unmounted the
// tree, and /staff came up blank for everybody - there was no way to sign in at
// all. `currentUser` is already nullable in the context, so read that.
//
// All the deciding is in `accessFor`/`denyAllAccess`, which are plain functions
// in `accessControl.ts` and are checked directly by the self-test. This hook only
// supplies the person.
import { useAuth } from '../context/AuthContext';
import { accessFor } from '../services/accessControl';

export function useAccess() {
  const { currentUser } = useAuth();

  return useMemo(
    () => accessFor(currentUser, id => db.getCustomRoleById(id)),
    [currentUser, currentUser?.customRoleId],
  );
}