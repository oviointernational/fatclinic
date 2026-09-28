/**
 * Minimal path router for the two public faces of this app:
 *
 *   /       -> the visitor landing page (not signed in)
 *   /staff  -> the clinic workstation (sign-in gate, then the dashboard)
 *
 * The app is deployed as Cloudflare Workers Static Assets with
 * "single-page-application" fallback (wranger.jsonc), so any path serves
 * index.html and routing happens in the browser. Everything that is not `/` is
 * treated as the staff app: predictable, and `/staff` stays the one canonical
 * address for the workstation.
 *
 * Deliberately dependency-free (no react-router): two routes, no nesting, no
 * query handling worth a library. The password-reset link lives in the URL
 * *fragment* (#access_token=...), which this router never touches, so routing
 * cannot steal it.
 */
import { useEffect, useState } from 'react';

export type Route = 'landing' | 'staff';

export function currentPath(): string {
  return typeof window === 'undefined' ? '/' : window.location.pathname;
}

export function routeFor(path: string): Route {
  return path === '/' ? 'landing' : 'staff';
}

/** The current route, kept in sync with the address bar via popstate. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => routeFor(currentPath()));

  useEffect(() => {
    const onChange = () => setRoute(routeFor(currentPath()));
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, []);

  return route;
}

/**
 * Move between the landing page and the staff app without a full reload.
 *
 * pushState leaves any URL fragment (a reset link) intact. A synthetic
 * popstate event is dispatched because pushState does not fire one on its own,
 * and that is the event useRoute() listens for.
 */
export function navigate(path: string): void {
  if (typeof window === 'undefined') return;
  if (currentPath() === path) return;
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}