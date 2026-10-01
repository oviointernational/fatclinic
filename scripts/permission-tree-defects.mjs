/**
 * Does `check-permission-tree.mjs` actually catch a permission that cannot be
 * granted?
 *
 * The defect it guards is the one that reached the clinic: `AI` was added to
 * `PERMISSION_TREE` and not to the seed, so `role_permissions`'s foreign key
 * refused the grant and a role called "Has all rights" silently did not have it.
 * Every other check in the repository passed while that was true, because they
 * read the tree out of TypeScript and never asked the database.
 *
 * So each defect below removes an `AI` row from `database/fatclinic.sql` and
 * deletes the live rows, restoring both afterwards. The seed is edited rather
 * than only the database because the seed is the half that stays broken - a
 * database patched by hand and a seed left behind means the next fresh install
 * is wrong again, and the check reads the seed precisely so that cannot pass.
 *
 * Every statement is a targeted delete against keys the defect removed, so the
 * live data cannot be damaged by an interrupted run. Restore is bound to exit and
 * to the signals that kill a process, because a defect left in the tree reads on
 * the next run as a shipping failure - which has happened here before.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SEED = path.join(ROOT, 'database', 'fatclinic.sql');

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

const pg = require('pg');
const db = new pg.Client({
  host: env.PGHOST,
  port: Number(env.PGPORT),
  user: env.PGUSER,
  password: env.PGPASSWORD,
  database: env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

let seedOriginal = null;
// Serialises restore against the defect loop. `pg.Client` is one socket: a
// query issued while the previous restore is still in flight lands on whatever
// state the socket is in, which is how the first attempt at this script ended
// with "Client was closed and is not queryable" and then an unhandled socket
// error. A promise chain is the fix, and it is cheaper than reconnecting.
let chain = Promise.resolve();

const AI_NODES = [
  ['AI', null, 'Clinical AI Assistant', 1],
  ['AI.QUERY', 'AI', 'Natural language query', 2],
  ['AI.SUMMARIZE', 'AI', 'Patient summarizer', 2],
  ['AI.SAFEGUARDS', 'AI', 'Clinical AI safeguards', 2],
];

// Grants that are removed along with the nodes, kept so they can be put back.
//
// This matters and is easy to miss. A grant has to be deleted before its node,
// because `permission_nodes` is referenced - but "the clinic's real data is only
// whatever this script put back" is not a safe assumption. The role called "Chief
// Administrator" holds `AI` for a real physician, and a test that silently took
// it away would be changing what that physician can see in a clinical system.
// So the grants are read out first and written back verbatim.
let savedGrants = null;

async function captureGrants() {
  const { rows } = await db.query(
    `select role_id, permission_key from role_permissions where permission_key = any($1)`,
    [AI_NODES.map((n) => n[0])],
  );
  savedGrants = rows.map((r) => [r.role_id, r.permission_key]);
  return savedGrants.length;
}

/**
 * Put everything back, on the shared connection.
 *
 * It does NOT close the client: the same socket is used for the next defect's
 * deletes and for the verification at the end, and closing it mid-run is what
 * broke the earlier attempt. Only the top-level teardown ends the connection.
 */
function restore() {
  chain = chain.then(async () => {
    try {
      if (seedOriginal !== null) {
        writeFileSync(SEED, seedOriginal);
        seedOriginal = null;
      }
      // Nodes before grants: the grant's foreign key needs the node to exist.
      for (const [key, parent, label, depth] of AI_NODES) {
        await db.query(
          `insert into permission_nodes (key, parent_key, label, depth) values ($1,$2,$3,$4)
             on conflict (key) do nothing`,
          [key, parent, label, depth],
        );
      }
      for (const [roleId, key] of savedGrants ?? []) {
        await db.query(
          `insert into role_permissions (role_id, permission_key) values ($1,$2)
             on conflict (role_id, permission_key) do nothing`,
          [roleId, key],
        );
      }
    } catch (err) {
      console.error(`\n[permission-tree defects] RESTORE FAILED: ${err.message}`);
      console.error('  The AI nodes may need re-inserting: node scripts/migrate-role-grants.mjs --apply');
      process.exitCode = 1;
    }
  });
  return chain;
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    restore().finally(() => {
      db.end().catch(() => {});
      process.exit(130);
    });
  });
}
process.on('exit', () => {
  // Synchronous, so it is the only thing that can be relied on in a hard exit.
  if (seedOriginal !== null) writeFileSync(SEED, seedOriginal);
});

/** Remove lines from the seed that declare any of these keys. */
function dropFromSeed(keys) {
  if (seedOriginal === null) seedOriginal = readFileSync(SEED, 'utf8');
  const lines = seedOriginal.split(/\r?\n/);
  const kept = lines.filter(
    (l) => !keys.some((k) => new RegExp(`^\\s*\\('${k.replace(/\./g, '\\.')}'\\s*,`).test(l)),
  );
  const removed = lines.length - kept.length;
  if (removed === 0) throw new Error(`no seed line matched ${keys.join(', ')} - the seed has changed shape`);
  writeFileSync(SEED, kept.join('\n'));
  return removed;
}

const DEFECTS = [
  {
    name: 'a module added to the tree is missing from the seed, so it cannot be granted to anybody',
    keys: ['AI', 'AI.QUERY', 'AI.SUMMARIZE', 'AI.SAFEGUARDS'],
  },
  {
    name: 'one leaf of a module is missing from the seed, so that leaf is un-grantable',
    keys: ['AI.SUMMARIZE'],
  },
];

const run = () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'check-permission-tree.mjs')], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
};

console.log('[permission-tree defects] proving the permission-tree check detects each regression');

const grantCount = await captureGrants();
console.log(`  holding ${grantCount} live grant(s) aside so the injections cannot take real access away`);

let allCaught = true;

for (const d of DEFECTS) {
  await restore();

  // Take the defect away from both halves: the seed, and the live table. The
  // grants go first - `permission_nodes` has children referring to it, and a
  // role that holds the key being removed would block the delete and turn the
  // injection into a failed test rather than a real one.
  const lines = dropFromSeed(d.keys);
  await chain.then(async () => {
    await db.query(`delete from role_permissions where permission_key = any($1)`, [d.keys]);
    await db.query(`delete from permission_nodes where key = any($1)`, [d.keys]);
  });

  const { code, out, err } = run();
  const failedLines = out.split(/\r?\n/).filter((l) => /\bFAIL\b/.test(l));
  const caught = code !== 0;

  console.log(`\n  ${d.name}`);
  console.log(`      removed ${lines} seed line(s) and ${d.keys.length} database row(s)`);
  if (caught) {
    console.log(`      detected: ${failedLines.length} check(s) failed`);
    for (const l of failedLines.slice(0, 3)) console.log(`        - ${l.trim()}`);
  } else {
    allCaught = false;
    console.log('      NOT DETECTED - the check passed with the defect present');
    if (err.trim()) console.log(`        stderr: ${err.trim().split('\n')[0]}`);
  }
}

await restore();

// The restore is only claimed if the database actually agrees afterwards, and
// the grants too - `permission-tree-defects` removes them, so a role that held
// the key would come back without it and the next run would be repairing real
// data rather than its own mess.
const { rows: back } = await chain.then(() =>
  db.query(`select count(*)::int as n from permission_nodes where key like 'AI%'`),
);
const { rows: grantBack } = await chain.then(() =>
  db.query(`select count(*)::int as n from role_permissions where permission_key = any($1)`, [AI_NODES.map((n) => n[0])]),
);
const seedHasAll = readFileSync(SEED, 'utf8').includes("('AI', NULL, 'Clinical AI Assistant'");

if (back[0].n === 4 && grantBack[0].n === grantCount && seedHasAll) {
  console.log(`\n[permission-tree defects] every defect was caught; seed restored, 4 nodes and ${grantCount} grant(s) verified back in place`);
} else {
  allCaught = false;
  console.log(`\n[permission-tree defects] every defect was caught, but RESTORE IS INCOMPLETE`);
  console.log(`  nodes ${back[0].n}/4, grants ${grantBack[0].n}/${grantCount}, seed ${seedHasAll ? 'ok' : 'MISSING'}`);
  console.log('  run: node scripts/migrate-role-grants.mjs --apply');
}

await db.end();
process.exitCode = allCaught ? 0 : 1;
