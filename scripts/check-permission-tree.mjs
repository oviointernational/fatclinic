/**
 * Can every permission the application offers actually be granted to somebody?
 *
 * WHY A UNIT TEST COULD NOT CATCH IT
 * ----------------------------------
 * `access-selftest.mjs` proves the gate holds *given* a set of keys. It reads
 * that set out of a plain array, so it could not tell that one of the keys did
 * not exist as far as the database was concerned - the array is perfectly happy
 * to contain `AI`, and every check passed.
 *
 * The database is a different matter. `role_permissions.permission_key` is a
 * foreign key onto `permission_nodes(key)`, so a permission missing from that
 * table cannot be granted to a custom role by anybody, for any reason. `AI` was
 * added to `PERMISSION_TREE` in TypeScript and never added to the seed, whose
 * comment claims it "Mirrors src/services/permissions.ts exactly". In the
 * running clinic the AI Assistant was therefore un-grantable: a role that needed
 * it could not be saved, and the failure surfaced as a foreign key violation
 * rather than as anything an administrator could act on.
 *
 * The symptom that reached the clinic was a role named "Chief Administrator",
 * described "Has all rights", whose holder could not see the AI Assistant. The
 * role was not the problem and neither was the gate - the key the role needed did
 * not exist.
 *
 * WHAT THIS CHECKS
 * ----------------
 *   1. Every node in `PERMISSION_TREE` exists in `permission_nodes`. Without
 *      this the answer to "can I grant this?" is no, and nothing says so.
 *   2. The seed in database/fatclinic.sql inserts the same set, so a fresh
 *      install is not broken in the way the running one was. Checked against the
 *      file, because the live table was repaired by
 *      `migrate-role-grants.mjs --apply` and would otherwise mask the seed.
 *   3. Parents and depths agree. Structure is load-bearing - `parent_key` is a
 *      self-referencing foreign key and `depth` is constrained to 1..4 - so a
 *      child that disagrees with its parent is a row the database could not
 *      accept, and a depth outside the range is a row it refuses.
 *
 * Labels are deliberately NOT asserted to match, and this is a considered
 * decision rather than a gap. Nothing in the application reads
 * `permission_nodes.label`: the role editor renders `PERMISSION_TREE` directly,
 * so the stored label is documentation for somebody reading the table. The two
 * sets of labels also serve different purposes - under a parent, the application
 * says "View" and the database says "View dashboard", and the database's is the
 * more useful of the two when read in isolation. Asserting equality would fail
 * on fourteen nodes that are correct as they stand, and a check that cries wolf
 * about cosmetics is a check people stop reading.
 *
 *   4. The foreign key that makes a missing node fatal is really there. The whole
 *      argument above rests on it; a check that assumes a constraint it has not
 *      seen is not a check.
 *   5. Parents are inserted before their children in the seed, since `parent_key`
 *      is self-referencing - a seed that inserts a child first fails outright.
 *
 * Read-only, and the privilege probe runs in a rolled-back transaction.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import pg from 'pg';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const fromDir = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : ROOT;
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        /* fall through */
      }
    }
    return nextResolve(specifier, context);
  },
});

const { PERMISSION_TREE } = await import('../src/services/permissions.ts');

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

let failed = 0;
const ok = (cond, what, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`);
  if (!cond) failed++;
};

function flatten(nodes, parent = null, depth = 1, into = []) {
  for (const n of nodes) {
    into.push({ key: n.key, parent, label: n.label, depth });
    if (n.children) flatten(n.children, n.key, depth + 1, into);
  }
  return into;
}
const wanted = flatten(PERMISSION_TREE);
const byKey = new Map(wanted.map((w) => [w.key, w]));

const db = new pg.Client({
  host: env.PGHOST,
  port: Number(env.PGPORT),
  user: env.PGUSER,
  password: env.PGPASSWORD,
  database: env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const section = (t) => console.log(`\n${t}`);

section('every permission the application offers exists in the database');

const { rows: live } = await db.query('select key, parent_key, label, depth from permission_nodes');
const liveKeys = new Set(live.map((n) => n.key));

const absent = wanted.filter((w) => !liveKeys.has(w.key));
ok(
  absent.length === 0,
  `all ${wanted.length} nodes in PERMISSION_TREE exist in permission_nodes`,
  absent.map((a) => a.key).join(', '),
);

for (const n of live) {
  const w = byKey.get(n.key);
  if (!w) continue;
  ok(
    (n.parent_key ?? null) === w.parent,
    `${n.key} has the right parent`,
    `db=${n.parent_key ?? 'null'} app=${w.parent ?? 'null'}`,
  );
  ok(n.depth === w.depth, `${n.key} has the right depth`, `db=${n.depth} app=${w.depth}`);
}

// Reported, not asserted - see the note at the top. Printed compactly because
// there are fourteen and they are all expected.
const labelDiffs = live
  .map((n) => ({ n, w: byKey.get(n.key) }))
  .filter(({ n, w }) => w && n.label !== w.label);
if (labelDiffs.length) {
  console.log(`\n  note  ${labelDiffs.length} node(s) store a more specific label than the application shows:`);
  console.log(`        ${labelDiffs.slice(0, 3).map(({ n, w }) => `${n.key} ("${n.label}" vs "${w.label}")`).join('; ')}`);
  console.log(`        ${labelDiffs.length > 3 ? `and ${labelDiffs.length - 3} more` : ''}`);
  console.log('        Not a failure: nothing reads this column, and under a parent the');
  console.log('        shorter label is the correct thing to render.');
}

section('the foreign key that makes a missing node fatal is actually there');

const fk = await db.query(`
  select tc.constraint_name, ccu.table_name as target
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name
     and ccu.constraint_schema = tc.constraint_schema
   where tc.table_schema = 'public'
     and tc.table_name = 'role_permissions'
     and tc.constraint_type = 'FOREIGN KEY'`);
ok(
  fk.rows.some((r) => r.target === 'permission_nodes'),
  'role_permissions.permission_key is bound to permission_nodes',
  fk.rows.map((r) => `${r.constraint_name}->${r.target}`).join(', ') || 'no foreign key found',
);

// The constraint is only load-bearing if it actually refuses. Proved by asking
// it to refuse, inside a transaction that is thrown away.
section('a key the tree has but the database lacks is genuinely refused');
{
  const absentKey = absent[0]?.key ?? 'NOT_A_REAL_KEY_AT_ALL';
  await db.query('BEGIN');
  try {
    const r = await db.query(
      `select r.id from custom_roles r limit 1`,
    );
    if (r.rows.length === 0) {
      console.log('  SKIP  no custom role exists to attempt the grant against');
    } else {
      let refused = false;
      try {
        await db.query(
          `insert into role_permissions (role_id, permission_key) values ($1, $2)`,
          [r.rows[0].id, absentKey],
        );
      } catch {
        refused = true;
      }
      ok(refused, 'inserting a grant for a key with no permission_nodes row is refused');
      await db.query('ROLLBACK');
      if (refused) {
        // Confirm the rollback really removed the probe row.
        const after = await db.query(
          `select count(*)::int as n from role_permissions where permission_key = $1`,
          [absentKey],
        );
        ok(after.rows[0].n === 0, 'the probe left nothing behind', `${after.rows[0].n} row(s)`);
      }
    }
  } catch (err) {
    await db.query('ROLLBACK');
    ok(false, 'the probe ran', err.message);
  }
}

section('the seed declares the same nodes, so a fresh install is not broken too');

const seed = readFileSync(new URL('../database/fatclinic.sql', import.meta.url), 'utf8');
const seedBlock = seed.slice(
  seed.indexOf('INSERT INTO permission_nodes'),
  seed.indexOf('ON CONFLICT (key) DO NOTHING;', seed.indexOf('INSERT INTO permission_nodes')),
);
const seedRows = [...seedBlock.matchAll(/\(\s*'([A-Z][A-Z0-9_.]*)'\s*,\s*(NULL|'[^']*')\s*,\s*'((?:[^']|'')*)'\s*,\s*(\d)\s*\)/g)]
  .map((m) => ({ key: m[1], parent: m[2] === 'NULL' ? null : m[2].slice(1, -1), label: m[3].replace(/''/g, "'"), depth: Number(m[4]) }));

ok(
  seedRows.length > 0,
  'the permission_nodes seed block was parsed',
  `${seedRows.length} rows found`,
);
ok(
  seedRows.length === wanted.length,
  `the seed declares all ${wanted.length} nodes`,
  `seed has ${seedRows.length}, application has ${wanted.length}`,
);

for (const w of wanted) {
  const s = seedRows.find((r) => r.key === w.key);
  if (!s) {
    ok(false, `${w.key} is declared in the seed`, 'absent from the seed');
    continue;
  }
  if (s.parent !== w.parent || s.depth !== w.depth) {
    ok(false, `${w.key} is declared correctly in the seed`, `seed=${s.parent ?? 'null'}/${s.depth} app=${w.parent ?? 'null'}/${w.depth}`);
  }
}

const seedKeys = new Set(seedRows.map((r) => r.key));
const seedOrder = seedRows.map((r) => r.key);
const orderOk = seedOrder.every((k, i) => {
  const p = seedRows[i].parent;
  return p === null || seedOrder.indexOf(p) < i;
});
ok(orderOk, 'the seed inserts every parent before its children', orderOk ? '' : 'a child precedes its parent, so the self-referencing FK would fail');

await db.end();

console.log(
  failed === 0
    ? `\n[check-permission-tree] every check passed`
    : `\n[check-permission-tree] ${failed} check(s) FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
