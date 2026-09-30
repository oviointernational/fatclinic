/**
 * Which commit is running in this browser.
 *
 * Read this when a clinician reports something that the code says cannot happen.
 * The answer distinguishes the two possibilities that look identical from the
 * outside - the code is wrong, or the code being run is not this code - and on
 * 2026-09-30 those looked identical for an entire morning: a laboratory fix was
 * pushed and verified against the live database, and the site was still serving
 * the bundle from before it, because deployment here is a manual step that nobody
 * was watching for.
 *
 * The value is substituted at build time by the `__BUILD_COMMIT__` define in
 * vite.config.ts. It is a literal string in the shipped bundle, which is what lets
 * `npm run deploy:check` read it back over HTTP with no credentials and no
 * dashboard.
 *
 * `unknown` is a real answer, not a default to be hidden: it means the bundle was
 * built where git was unavailable, and a site reporting `unknown` cannot be shown
 * to be current by anything.
 */
declare const __BUILD_COMMIT__: string;

export const BUILD_COMMIT: string =
  typeof __BUILD_COMMIT__ === 'string' && __BUILD_COMMIT__ ? __BUILD_COMMIT__ : 'unknown';

/** Short enough to sit in a footer, long enough to be unambiguous. */
export const BUILD_LABEL = BUILD_COMMIT === 'unknown' ? 'build unknown' : `build ${BUILD_COMMIT.slice(0, 7)}`;