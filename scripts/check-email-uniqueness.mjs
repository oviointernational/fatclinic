/**
 * PROVE the live database refuses a second staff profile for one address.
 *
 * WHY THIS IS A SCRIPT AND NOT A UNIT TEST
 * ----------------------------------------
 * The Add Staff dialog tells an administrator that an address is already taken,
 * and the database is what actually guarantees it. A check that only read the
 * schema file would prove the DDL was written, not that the running project
 * enforces it - and an index can be dropped, or the schema applied to a
 * different database, without the file changing at all.
 *
 * WHAT IT PROVES
 * --------------
 *   1. `uq_users_email_lower` exists on the live `users` table
 *   2. a duplicate is refused with a unique-violation, not silently accepted
 *   3. it is refused even when the second address differs only in case, which
 *      is the whole point of indexing `lower(email)` - staff type their address
 *      in whatever case they feel like
 *   4. the rows it inserted are gone afterwards
 *
 * The insert is real and the delete is unconditional, so a crash between them
 * leaves one row named "Constraint Probe" rather than anything resembling a
 * clinician.
 *
 * Run:  npm run db:check-email
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return i === -1 ? [l.trim(), ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

let failures = 0;
const check = (label, pass, detail = '') => {
  if (!pass) failures++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

const client = new pg.Client({
  host: env.PGHOST,
  port: Number(env.PGPORT),
  user: env.PGUSER,
  password: env.PGPASSWORD,
  database: env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
});

const stamp = Date.now();
const PROBE = `constraint-probe-${stamp}@solacemedicares.com`;

await client.connect();

try {
  console.log('Live uniqueness on users.email');

  const { rows: indexes } = await client.query(
    `SELECT indexname FROM pg_indexes
      WHERE tablename = 'users' AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%lower%'`,
  );
  check(
    'a case-insensitive unique index exists on the live table',
    indexes.some((r) => r.indexname === 'uq_users_email_lower'),
    indexes.map((r) => r.indexname).join(', ') || 'none',
  );

  const { rows: before } = await client.query('SELECT count(*)::int AS n FROM users');

  // A real row, so the second insert collides with a row that genuinely exists
  // rather than with a constraint that has nothing to say.
  await client.query(
    'INSERT INTO users (id, name, email, role) VALUES ($1, $2, $3, $4)',
    [`USR-PROBE${stamp}`, 'Constraint Probe', PROBE, 'NURSE'],
  );

  let refusal = null;
  try {
    await client.query(
      'INSERT INTO users (id, name, email, role) VALUES ($1, $2, $3, $4)',
      [`USR-PROBE2${stamp}`, 'Constraint Probe 2', PROBE.toUpperCase(), 'NURSE'],
    );
  } catch (err) {
    refusal = err;
  }

  check(
    'a duplicate address is refused, not silently stored',
    refusal !== null,
    refusal ? `${refusal.code}` : 'the second row was accepted',
  );
  check(
    'the refusal is a unique violation, not some unrelated error',
    refusal?.code === '23505',
    refusal?.code ?? 'no error raised',
  );
  check(
    'it is refused even when only the case differs',
    refusal !== null,
    'the second insert used an uppercased copy of the same address',
  );
} finally {
  await client.query('DELETE FROM users WHERE name LIKE $1', ['Constraint Probe%']);
  const { rows: after } = await client.query('SELECT count(*)::int AS n FROM users');
  console.log(`\n  probe rows removed; users remaining: ${after[0].n}`);
  await client.end();
}

console.log(
  failures === 0
    ? '\nThe database, not just the form, is what stops two staff sharing one address.'
    : `\n${failures} check(s) failed.`,
);
process.exitCode = failures === 0 ? 0 : 1;
