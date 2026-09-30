import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

/**
 * The commit this bundle was built from, baked into it.
 *
 * WHY
 * ---
 * This project is deployed by hand (`npm run deploy`). Nothing rebuilds it on a
 * push, and there is no CI to do it. The result is the failure that cost a
 * morning on 2026-09-30: a laboratory fix was committed, pushed and verified
 * against the live database, and the live site kept serving the previous bundle,
 * so the fix was never in front of a clinician and the bug it fixed was still
 * there. Every layer below was green. Only the deployed bytes were old.
 *
 * The marker makes that a question with an answer. `npm run deploy:check` fetches
 * the live site and compares this commit against the repository's HEAD, so "is the
 * site running the current code?" stops being something to be confident about.
 * It is shown on the sign-in screen too, so the answer is available to whoever is
 * looking at the screen that is actually wrong.
 *
 * Falls back to 'unknown' where git is not available, rather than failing the
 * build: a bundle without a marker is worse, but a bundle that cannot be built at
 * all is worse still, and the check script reports 'unknown' rather than passing.
 */
function buildCommit(): string {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

// https://vitejs.dev/config/
//
// No dev proxy: the browser talks to Supabase directly over HTTPS, so there is
// no local API to forward to. If a /api call reappears in the app it is a bug -
// the data layer goes through src/services/supabase.ts, not a local server.
export default defineConfig(({ command, mode }) => {
  // A build that ships without a Supabase URL is worse than a build that fails.
  //
  // src/services/supabase.ts intentionally falls back to "local-only mode" when
  // the variables are absent, so that a fresh checkout still boots for UI work.
  // That fallback is a trap for `npm run build`: it produces a bundle that
  // deploys cleanly, renders the sign-in screen, and can never authenticate -
  // with nothing in the logs to say why. This deployment is a Workers Static
  // Assets project, so there is no Cloudflare-side build step to inject the
  // values later; whatever is missing here is missing forever.
  //
  // `dev` stays permissive on purpose. `build` does not.
  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    const url = env.VITE_SUPABASE_URL?.trim();
    const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();

    const missing: string[] = [];
    if (!url) missing.push('VITE_SUPABASE_URL');
    if (!anonKey) missing.push('VITE_SUPABASE_ANON_KEY');

    // A placeholder that survived a copy-paste from .env.example is as broken as
    // a missing value, and "it built fine" makes it look fine.
    const placeholders = [
      ['VITE_SUPABASE_URL', url],
      ['VITE_SUPABASE_ANON_KEY', anonKey],
    ] as const;
    for (const [name, value] of placeholders) {
      if (value && /\[YOUR-|your-ref|xxxxx/i.test(value)) {
        throw new Error(
          `[fatclinic] ${name} still contains a placeholder: "${value}".\n`
          + '  Copy .env.example to .env and fill in the real value from\n'
          + '  Supabase -> Project Settings -> API.',
        );
      }
    }

    if (missing.length) {
      // .env.production carries both values and is committed, so a CI build on
      // Cloudflare's machines works with no setup at all. This guard is for the
      // one case that still means something: a checkout where that file is
      // missing or a placeholder survived a copy-paste. Without it the bundle
      // builds, deploys, renders the sign-in screen, and can never authenticate,
      // with nothing in the logs to explain why.
      throw new Error(
        `[fatclinic] cannot build: ${missing.join(' and ')} not set.\n`
        + '  .env.production is committed and holds both values. If it is missing,\n'
        + '  restore it from git. A local .env overrides it when present.\n'
        + '  (npm run dev still works without them - local-only mode.)',
      );
    }
  }

  return {
    plugins: [react()],
    // Replaced at build time by the literal string above. `define` rather than an
    // import.meta.env variable, because the value has to survive minification into
    // the bundle - an env lookup would be a property access on a runtime object,
    // which is both tree-shakeable away and absent in a static deployment.
    define: {
      __BUILD_COMMIT__: JSON.stringify(buildCommit()),
    },
    server: {
      port: 5173,
      host: true
    }
  };
});
