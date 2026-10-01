/**
 * Report - and optionally repair - access-control roles that have fallen behind
 * the permission tree.
 *
 * THE DEFECT THIS EXISTS TO END
 * -----------------------------
 * A custom role is stored as the set of permission keys it held at the moment it
 * was saved: one row in `role_permissions` per key. That is correct, and it has a
 * consequence nobody was told about. When a module is added to `PERMISSION_TREE`
 * later, every role saved before that moment is now quietly short of it, and the
 * role's own name and description go on claiming otherwise.
 *
 * This is not theoretical. The report the clinic sent was: a role called
 * "Chief Administrator", described "Has all rights", granted to a physician, who
 * could not see one part of the menu. The cause was `AI`, a node added to the
 * tree with the navigation gate. Two ordinary things had to coincide:
 *
 *   1. the role could not contain a module that did not exist when it was saved;
 *   2. assigning a custom role REPLACES the base role rather than adding to it -
 *      and that physician's base `PHYSICIAN` grants did include `AI`, so the
 *      assignment took the AI Assistant away.
 *
 * Every other department stayed visible, which is what made it read as a broken
 * gate rather than an incomplete role.
 *
 * THE DEFECT BENEATH THAT ONE
 * ---------------------------
 * Fixing the role hit a foreign key, and the foreign key is the real story.
 * `role_permissions.permission_key` REFERENCES `permission_nodes(key)`, so a
 * permission that is not a row in `permission_nodes` cannot be granted to
 * anyone by anybody. The comment above that seed says it "Mirrors
 * src/services/permissions.ts exactly", and it did not: `AI` was added to the
 * tree in TypeScript and never added to the seed, so in the running clinic the
 * AI Assistant was un-grantable to a custom role. Not hidden - un-grantable.
 * A role that needed it failed with a foreign key violation, which is not an
 * answer an administrator can act on.
 *
 * So this reconciles the two first: every node the application has and the
 * database does not is inserted, and every node the database has and the
 * application does not is reported. Only inserts are performed - a node that
 * exists solely in the database may be a grant somebody relies on, and removing
 * it would cascade-delete that grant through the FK.
 *
 * WHAT IT DOES
 * ------------
 * With no arguments this is strictly read-only: it prints every role, how much of
 * the tree it covers, which modules it is missing, and who holds it. That report
 * is the point - it can be run at any time and answers "does any role no longer
 * do what its name says", and "can every permission the application offers
 * actually be granted".
 *
 * `--grant <roleId>` says which role is *meant* to be unrestricted, and the
 * script adds only the modules it is missing. That is deliberately not automatic.
 * Topping up every role would hand a narrowly-drawn role ("Histopathology, no
 * result entry") the whole application the moment someone added a module, which
 * is the opposite of what that role is for. A role is repaired by someone
 * choosing to repair it.
 *
 * The permission list is read from `src/services/permissions.ts` - the same
 * module the role editor and the navigation gate use - so this cannot drift from
 * what the application actually enforces.
 *
 * Run:  node scripts/migrate-role-grants.mjs                        (report only)
 *       node scripts/migrate-role-grants.mjs --grant ROLE-123        (plan)
 *       node scripts/migrate-role-grants.mjs --apply                  (reconcile tree)
 *       node scripts/migrate-role-grants.mjs --grant ROLE-123 --apply (write both)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import pg from 'pg';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Same shim `access-selftest.mjs` uses: the source is TypeScript with
// extensionless relative imports. Node strips the types; this supplies the
// extension so the script reads the real tree rather than a copy of it.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const fromDir = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : ROOT;
      if (readFileSync.length && false) { /* no-op */ }
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        /* fall through */
      }
    }
    return nextResolve(specifier, context);
  },
});

const {
  PERMISSION_TREE,
  countGranted,
  totalPermissionCount,
  grantEverything,
  missingModules,
} = await import('../src/services/permissions.ts');

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

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const grantIds = process.argv.reduce((acc, v, i, all) => (v === '--grant' ? [...acc, all[i + 1]] : acc), []);
const apply = process.argv.includes('--apply');

const db = new pg.Client({
  host: env.PGHOST,
  port: Number(env.PGPORT),
  user: env.PGUSER,
  password: env.PGPASSWORD,
  database: env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const say = (line) => console.log(line);
const head = (line) => console.log(`\n${line}`);

/** Flatten the tree to `{ key, parent, label, depth }` in parent-before-child order. */
function flattenTree(nodes, parent = null, depth = 1, into = []) {
  for (const n of nodes) {
    into.push({ key: n.key, parent, label: n.label, depth });
    if (n.children) flattenTree(n.children, n.key, depth + 1, into);
  }
  return into;
}
const wanted = flattenTree(PERMISSION_TREE);

const total = totalPermissionCount();
head(`[migrate-role-grants] the permission tree holds ${total} permissions across ${PERMISSION_TREE.length} modules`);

const roles = await db.query(
  `select r.id, r.name, r.description, r.created_at,
          coalesce(array_agg(rp.permission_key) filter (where rp.permission_key is not null), '{}') as keys
     from custom_roles r
     left join role_permissions rp on rp.role_id = r.id
    group by r.id, r.name, r.description, r.created_at
    order by r.created_at`,
);

const holders = await db.query(
  `select u.custom_role_id, array_agg(u.name order by u.name) as names
     from users u where u.custom_role_id is not null group by u.custom_role_id`,
);
const heldBy = new Map(holders.rows.map((h) => [h.custom_role_id, h.names]));

// --- the tree the database can actually grant ------------------------------
//
// Checked before the roles, because a role report is misleading when a
// permission cannot be granted to anybody: it would read as a role being
// incomplete when in fact the key does not exist for the database to point at.
const nodes = await db.query(`select key, parent_key, label, depth from permission_nodes`);
const have = new Set(nodes.rows.map((n) => n.key));
const absent = wanted.filter((n) => !have.has(n.key));
const extra = nodes.rows.filter((n) => !wanted.some((w) => w.key === n.key));

head('[migrate-role-grants] can every permission the application offers be granted?');
say(`  the application declares ${wanted.length} nodes; the database holds ${nodes.rows.length}`);
if (absent.length === 0) {
  say('  every permission exists in permission_nodes, so any of them can be granted');
} else {
  say(`  NOT IN permission_nodes, therefore un-grantable to any custom role:`);
  for (const n of absent) say(`    ${n.key}  (${n.label})`);
  if (apply) {
    await db.query('BEGIN');
    try {
      for (const n of absent) {
        await db.query(
          `insert into permission_nodes (key, parent_key, label, depth) values ($1, $2, $3, $4)
             on conflict (key) do nothing`,
          [n.key, n.parent, n.label, n.depth],
        );
      }
      await db.query('COMMIT');
      say(`  inserted ${absent.length} node(s)`);
    } catch (err) {
      await db.query('ROLLBACK');
      say(`  FAILED to insert, nothing written: ${err.message}`);
      await db.end();
      process.exit(1);
    }
  } else {
    say('  re-run with --apply to insert them');
  }
}
if (extra.length) {
  // Not deleted, and deliberately so.
  say(`  in permission_nodes but not in the application (left alone - deleting would`);
  say(`  cascade-delete the grants pointing at them): ${extra.map((n) => n.key).join(', ')}`);
}

head('[migrate-role-grants] every access-control role');
if (roles.rows.length === 0) say('  none defined');

let complete = 0;
for (const r of roles.rows) {
  const missing = missingModules(r.keys);
  if (!missing.length) complete++;
  const who = heldBy.get(r.id);
  say(`\n  ${r.name}  (${r.id})`);
  say(`    saved ${String(r.created_at).slice(0, 10)}  -  ${countGranted(r.keys)} of ${total} permissions granted`);
  say(`    held by: ${who ? who.join(', ') : 'nobody'}`);
  if (missing.length) {
    say(`    does not grant: ${missing.map((m) => m.label).join(', ')}`);
  }
}

// The trap this report exists to make visible, stated once and plainly rather
// than attached to every role. A role that was saved before a module existed
// cannot contain that module, so a role named "has all rights" can stop meaning
// that without anything having changed on the role's own row.
if (roles.rows.length > complete) {
  head('[migrate-role-grants] a role saved before a module existed cannot contain it');
  say('  The list above is not by itself a fault: a role like "Histopathology, no');
  say('  result entry" is *meant* to be narrow. It becomes one when the role was');
  say('  meant to be unrestricted - which is a question about intent, not something');
  say('  this script can read. The symptom to look for is a role whose name and');
  say('  description say "everything" while the list above is non-empty.');
  say('  Repair one by naming it: --grant <roleId> [--apply]');
}

if (grantIds.length === 0) {
  head('[migrate-role-grants] nothing to repair (pass --grant <roleId> to plan a repair)');
  await db.end();
  process.exit(0);
}

head(`[migrate-role-grants] repairing ${grantIds.length} role(s)${apply ? '' : ' (DRY RUN - nothing will be written)'}`);

const everything = grantEverything();
let repaired = 0;

await db.query('BEGIN');
try {
  for (const id of grantIds) {
    const r = roles.rows.find((x) => x.id === id);
    if (!r) {
      say(`\n  ${id}: no such role - not touched`);
      continue;
    }
    // Only the modules this role is actually missing. Granting a top-level key
    // grants everything under it, so the stored set stays in the same minimal
    // form `togglePermission` rolls up to and a later "grant everything" is a
    // no-op rather than a rewrite.
    const add = everything.filter((k) => !r.keys.includes(k));
    if (add.length === 0) {
      say(`\n  ${r.name} (${id}) already covers the whole tree - not touched`);
      continue;
    }
    say(`\n  ${r.name} (${id})`);
    say(`    adding: ${add.join(', ')}`);
    say(`    ${countGranted(r.keys)} of ${total} -> ${total} of ${total}`);
    if (apply) {
      for (const key of add) {
        await db.query(
          `insert into role_permissions (role_id, permission_key) values ($1, $2)
             on conflict (role_id, permission_key) do nothing`,
          [id, key],
        );
      }
      say(`    written: ${add.length} grant(s)`);
    }
    repaired++;
  }
  if (apply) {
    // Read back what the server holds rather than trusting the write.
    for (const id of grantIds) {
      const { rows } = await db.query(
        `select count(*)::int as n from role_permissions where role_id = $1`,
        [id],
      );
      const after = await db.query(
        `select coalesce(array_agg(permission_key), '{}') as keys from role_permissions where role_id = $1`,
        [id],
      );
      const still = missingModules(after.rows[0].keys);
      say(`\n  verified ${id}: ${rows[0].n} grant rows, ${still.length} module(s) still missing${still.length ? ` (${still.map((m) => m.key).join(', ')})` : ''}`);
    }
  }
  await db.query(apply ? 'COMMIT' : 'ROLLBACK');
} catch (err) {
  await db.query('ROLLBACK');
  say(`\n[migrate-role-grants] failed and nothing was written: ${err.message}`);
  await db.end();
  process.exit(1);
}

await db.end();
say(`\n[migrate-role-grants] ${repaired} role(s) ${apply ? 'repaired' : 'would be repaired'}${apply ? '' : ' - re-run with --apply to write'}`);
