/**
 * Is the live site running the code in this repository?
 *
 * WHAT THIS EXISTS FOR
 * --------------------
 * Deployment is manual: `npm run deploy`, from a machine with a Cloudflare
 * credential. There is no CI workflow and no git integration, so a push changes
 * the repository and nothing else.
 *
 * On 2026-09-30 that produced a full morning of the worst kind of wrong. The
 * laboratory fix was committed, pushed, and verified end to end against the live
 * database: a real Medical Laboratory Scientist signed in, ordered a Full Blood
 * Count, collected, entered fourteen analytes and released it, and every field came
 * back out of the database. All green. Then a clinician reported that the same bug
 * was still there - which was true, and the reason was that the deployed bundle was
 * built before the fix existed. The database had the new panels; the browser did
 * not have the code that reads them.
 *
 * Nothing in the repository could tell the difference. So the bundle now carries the
 * commit it was built from (`__BUILD_COMMIT__` in vite.config.ts, shown on the
 * sign-in screen), and this script reads it back over plain HTTP and compares it
 * with HEAD.
 *
 * It needs no Cloudflare credential, because it does not deploy anything. It only
 * fetches the public site.
 *
 * Run:  npm run deploy:check
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Where the clinic actually is. Read from .env so there is one source for it. */
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return i === -1
        ? [l.trim(), '']
        : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const SITE = (env.PUBLIC_SITE_URL || 'https://solacemedicares.com').replace(/\/+$/, '');

// `--local` inspects the build in dist/ instead of the live site. It answers a
// different question - "does the thing I just built actually carry the marker?" -
// and it is how the detection below is tested. A check that has only ever been
// run against a site it correctly calls stale has not been shown to recognise a
// current one.
const LOCAL = process.argv.includes('--local');

let head = 'unknown';
try {
  head = execSync('git rev-parse HEAD', { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
} catch {
  // Reported rather than assumed; an unknown HEAD cannot prove anything.
}

/**
 * The newest commit that can change what a browser runs.
 *
 * The question a clinician cares about is not "is the site at HEAD?" but "is
 * every fix that reaches a browser on the site?". A commit that only adds a
 * check script or edits a comment produces no change to any bundle, and a check
 * that calls the site stale for it is a check people learn to ignore - which
 * loses the one property that made it worth writing.
 *
 * So HEAD is accepted, and so is the last commit to touch anything that ends up
 * in the browser. What sits between them is named rather than counted, so what
 * has been published without a deploy is visible instead of implied.
 *
 * `rev-list` and `--oneline` rather than `--format=%H` and `--format=%h %s`,
 * because execSync on Windows goes through cmd.exe, which expands the `%h %s`
 * pair as one undefined variable and replaces it with nothing. The log silently
 * came back empty, and a tool whose entire job is to not be silent then reported
 * that nothing had been skipped.
 */
function lastBrowserCommit() {
  try {
    return (
      execSync('git rev-list -1 HEAD -- src public index.html vite.config.ts', {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
      }).trim() || head
    );
  } catch {
    return head;
  }
}

/** Commit subjects between two commits, newest first. */
function commitsBetween(from, to) {
  try {
    return execSync(`git log --oneline ${from}..${to}`, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    })
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const browserHead = head === 'unknown' ? head : lastBrowserCommit();

console.log(`[deploy:check] ${LOCAL ? 'local build in dist/' : SITE}`);
console.log(`[deploy:check] repository HEAD is ${head}`);
if (browserHead !== head) {
  console.log(`[deploy:check] newest commit touching the browser is ${browserHead.slice(0, 7)}`);
}
console.log('');

let html;
if (LOCAL) {
  try {
    html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  } catch (err) {
    console.error(`  !! no dist/index.html: ${err.message}`);
    console.error('     Run `npm run build` first.');
    process.exit(1);
  }
} else {
  try {
    const page = await fetch(`${SITE}/`, { headers: { 'User-Agent': 'fatclinic-deploy-check' } });
    if (!page.ok) throw new Error(`${page.status} ${page.statusText}`);
    html = await page.text();
  } catch (err) {
    console.error(`  !! could not fetch the site: ${err.message}`);
    console.error('     Nothing can be said about what is deployed.');
    process.exitCode = 1;
    throw err;
  }
}

/**
 * The entry bundle, taken from the module script tag rather than by pattern.
 *
 * Matching `assets/index-*.js` anywhere in the page looks equivalent and is not:
 * it depends on no lazily loaded chunk ever being named that way, and a check
 * that silently starts reading the wrong file is a check that reports confidently
 * and wrongly. Attribute order varies, so the tag is parsed rather than pattern
 * matched - a `type="module"` script is the entry, and its absence is itself a
 * finding worth reporting.
 */
function entryBundle(page) {
  const tags = [...page.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
  const moduleTag = tags.find((a) => /type=["']module["']/.test(a)) ?? tags[0];
  const src = moduleTag?.match(/src=["']([^"']+)["']/)?.[1];
  return src ? src.replace(/^\/+/, '') : undefined;
}

const asset = entryBundle(html);
if (!asset) {
  console.error('  !! the page names no JavaScript bundle. Either the deploy is broken or');
  console.error('     the site is not this project.');
  process.exitCode = 1;
} else {
  console.log(`  ${LOCAL ? 'the build serves' : 'the site serves'} ${asset}`);

  let bundle;
  try {
    if (LOCAL) {
      bundle = readFileSync(new URL(`../dist/${asset}`, import.meta.url), 'utf8');
    } else {
      bundle = await (await fetch(`${SITE}/${asset}`, {
        headers: { 'User-Agent': 'fatclinic-deploy-check' },
      })).text();
    }
  } catch (err) {
    console.error(`  !! could not read the bundle: ${err.message}`);
    process.exit(1);
  }

  // The marker as it appears in a minified bundle: a bare string literal. Matched
  // loosely on purpose - the bundler may keep it as a property or inline it.
  const found = (bundle.match(/[0-9a-f]{40}/g) ?? []).filter((s) => bundle.includes(`"${s}"`));
  const commits = [...new Set(found)];

  if (!commits.length) {
    console.error('  !! the bundle carries no commit marker.');
    console.error('     It predates the marker, or it was built where git was unavailable.');
    console.error('     Either way it cannot be shown to be current. Redeploy.');
    process.exitCode = 1;
  } else if (head === 'unknown') {
    console.error(`  the bundle was built from ${commits[0]}, but this checkout's HEAD is unknown,`);
    console.error('  so they cannot be compared.');
    process.exitCode = 1;
  } else if (commits.includes(head)) {
    console.log(`  the bundle was built from ${head.slice(0, 7)}, which is HEAD.`);
    console.log('');
    console.log(
      LOCAL
        ? '[deploy:check] this build carries the current commit, and is ready to publish.'
        : '[deploy:check] the live site is running the code in this repository.',
    );
  } else if (commits.includes(browserHead)) {
    // The site is behind HEAD, but everything skipped since that build cannot
    // reach a browser. Said plainly rather than reported as stale, because the
    // whole point of this script is that it is worth believing when it says no.
    const skipped = commitsBetween(commits[0], head);
    console.log(`  the bundle was built from ${commits[0].slice(0, 7)}.`);
    console.log(`  the repository is at ${head.slice(0, 7)}, and the newest change that`);
    console.log(`  reaches a browser is ${browserHead.slice(0, 7)} - which is what is deployed.`);
    if (skipped.length) {
      console.log('');
      console.log(`  ${skipped.length} commit(s) since then change no browser code:`);
      for (const s of skipped) console.log(`      ${s}`);
      console.log('');
      console.log('  A deploy is not needed for any of these.');
    }
    console.log('');
    console.log(
      LOCAL
        ? '[deploy:check] this build carries every change that reaches a browser.'
        : '[deploy:check] the live site is running every fix that reaches a browser.',
    );
  } else {
    console.error(`  the bundle was built from ${commits[0].slice(0, 7)}.`);
    console.error(`  this repository is at ${head.slice(0, 7)}.`);
    console.error('');
    if (LOCAL) {
      console.error('  This build is behind the repository. Rebuild it:');
      console.error('');
      console.error('      npm run build');
    } else {
      console.error('  THE LIVE SITE IS NOT RUNNING THIS CODE.');
      console.error('  Anything fixed since that build is not in front of a clinician, whatever');
      console.error('  the database holds. Deploy it:');
      console.error('');
      console.error('      npm run deploy');
    }
    process.exitCode = 1;
  }
}