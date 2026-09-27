/**
 * Print the exact build-time variables to paste into the Cloudflare dashboard.
 *
 * WHY THIS EXISTS
 * ---------------
 * The bundle needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY at build time.
 * Locally, `npm run deploy` finds them in `.env` and works. But when Cloudflare
 * builds from a git push it compiles on its own servers, where `.env` does not
 * exist - it is gitignored, deliberately, because it also holds the
 * service_role key. So a git-connected build fails with:
 *
 *   [fatclinic] cannot build: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY not set.
 *
 * The fix is to set those two as BUILD-TIME variables in the Cloudflare
 * dashboard. Somebody has to copy two long values across by hand, and the
 * obvious way to get that wrong is to paste the wrong key out of `.env` - the
 * service_role key sits in the same file and would be catastrophic to put
 * anywhere near a build. So this prints the two lines, and nothing else.
 *
 * IT WILL NOT PRINT THE SERVICE ROLE KEY
 * --------------------------------------
 * Not as an option, not behind a flag. `VITE_`-prefixed variables are inlined
 * into published JavaScript, so anything printed here is destined to be
 * public. The service_role key is not a build input and is never printed.
 *
 * Run:  npm run deploy:vars
 */
import { readFileSync } from 'node:fs';

const FORBIDDEN = /SERVICE_ROLE|SECRET|PRIVATE/i;

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return i === -1 ? [l.trim(), ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const NEEDED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];

let failures = 0;
const check = (label, pass, detail = '') => {
  if (!pass) failures++;
  console.log(`  ${pass ? 'ok  ' : 'MISSING'}  ${label}${detail ? `  ${detail}` : ''}`);
};

console.log('Copy these two lines into Cloudflare as BUILD-TIME variables.\n');
for (const k of NEEDED) {
  if (FORBIDDEN.test(k)) throw new Error(`refusing to print ${k}: it is not a public build input`);
  const v = env[k];
  const present = Boolean(v) && !/\[YOUR-/.test(v);
  check(k, present, present ? `= ${v}` : 'not set in .env, or still a [YOUR-...] placeholder');
}

if (failures) {
  console.log('\nFix .env first (Supabase -> Project Settings -> API), then run this again.');
  process.exitCode = 1;
} else {
  console.log(`
Where to paste them
-------------------
Cloudflare dashboard -> Workers & Pages -> fatclinic -> Settings
-> Environment variables -> Add variable. Add each as a PLAIN TEXT variable.

Set them for BOTH "Production" and "Preview" if the dashboard asks, then
save and redeploy. The build succeeds on the next push either way.

Then confirm:

  npm run db:check-api         # nothing to do with the build, just a sanity check
  npm run build                # should now pass locally too

What must NOT go in there
-------------------------
SUPABASE_SERVICE_ROLE_KEY. This script will not print it and you should not
paste it. It bypasses Row Level Security completely, and any VITE_ variable
ends up in the published JavaScript that every browser downloads.

Both values above are safe to publish, and only because of that: the anon key
is designed to be public, and RLS is enabled and forced on every table. The
project URL is just a hostname. Nothing here can read or write a patient
record on its own.`);
}

process.exitCode = failures === 0 ? 0 : 1;
