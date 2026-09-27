import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

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
      // Which fix applies depends on who is running the build, and guessing wrong
      // sends people to create a file that cannot possibly help. CI is detected
      // from the variables the providers actually set, not from the name of the
      // build script, which differs per provider.
      const onCi = Boolean(process.env.CI)
        || Boolean(process.env.CF_PAGES)
        || Boolean(process.env.CF_PAGES_BRANCH)
        || Boolean(process.env.GITHUB_ACTIONS)
        || Boolean(process.env.VERCEL)
        || Boolean(process.env.NETLIFY);

      const fix = onCi
        ? '  This is a CI build on a remote machine, where .env does not and cannot\n'
        + '  exist (.env is gitignored because it also holds the service_role key).\n'
        + '  Set these as BUILD-TIME variables in the provider dashboard instead:\n'
        + '      Cloudflare: Workers & Pages -> this project -> Settings\n'
        + '                   -> Environment variables -> Add variable (plain text)\n'
        + '  Run `npm run deploy:vars` locally to print the exact values to paste.\n'
        + '  Put SUPABASE_SERVICE_ROLE_KEY nowhere - it is not a build input, and any\n'
        + '  VITE_ value is inlined into published JavaScript.'
        : '  Copy .env.example to .env and fill in the real values from\n'
        + '  Supabase -> Project Settings -> API.\n'
        + '  (npm run dev still works without them - it falls back to local-only mode.)';

      throw new Error(
        `[fatclinic] cannot build: ${missing.join(' and ')} not set.\n`
        + '  The bundle inlines these at build time and the deployed site has no\n'
        + '  server to supply them later, so a build without them produces a site\n'
        + '  that renders but can never sign in.\n'
        + fix,
      );
    }
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true
    }
  };
});
