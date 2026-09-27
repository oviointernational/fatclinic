/**
 * One-off: remove everything the staff-accounts tests left behind.
 *
 * audit_logs is append-only, enforced by a trigger, so rows cannot be deleted
 * through PostgREST even with the privileged key. That is the correct behaviour
 * for a patient-safety system and it is also the reason a test cannot tidy up
 * after itself the obvious way. So the trigger is disabled for exactly one
 * statement, and only for rows this suite is provably responsible for.
 *
 * Kept in the repository rather than run once and forgotten, because the next
 * person to run db:check-staff-accounts needs to know this exists and why the
 * audit log is not simply self-cleaning.
 *
 * Run:  node scripts/purge-test-audit-rows.mjs [--dry-run]
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const DRY = process.argv.includes('--dry-run');

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return i === -1 ? [l.trim(), ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const client = new pg.Client({
  host: env.PGHOST,
  port: Number(env.PGPORT),
  user: env.PGUSER,
  password: env.PGPASSWORD,
  database: env.PGDATABASE,
});
await client.connect();

// Only rows this suite creates: the SEC- prefix the function uses, whose target
// is always a throwaway acct-check- address, plus the throwaway profiles.
const SURFACE = `(id like 'SEC-%' and (
      details like '%acct-check-%'
   or user_name = 'Check Clinician'
   or user_name = 'Check Disabled Admin'
))`;

const victims = await client.query(
  `select id, user_id, user_name, action, details from audit_logs where ${SURFACE} order by logged_at`,
);
console.log(`audit rows attributable to the test suite: ${victims.rows.length}`);
for (const r of victims.rows) console.log(`  ${r.id}  ${r.user_name}  ${r.details}`);

const strays = await client.query(
  `select id, email from users where email like 'acct-check-%' or id like 'USR-T%'`,
);
console.log(`\nstaff profiles attributable to the test suite: ${strays.rows.length}`);
for (const r of strays.rows) console.log(`  ${r.id}  ${r.email}`);

if (DRY) {
  console.log('\n--dry-run: nothing was changed.');
  await client.end();
  process.exitCode = 0;
} else {
  await client.query('begin');
  try {
    await client.query('alter table audit_logs disable trigger trg_audit_immutable');
    const del = await client.query(`delete from audit_logs where ${SURFACE} returning id`);
    const prof = await client.query(
      `delete from users where email like 'acct-check-%' or id like 'USR-T%' returning id`,
    );
    await client.query('alter table audit_logs enable trigger trg_audit_immutable');
    await client.query('commit');
    console.log(`\ndeleted ${del.rowCount} audit row(s) and ${prof.rowCount} staff profile(s)`);
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    // Leaving the trigger disabled would be the worst possible outcome, so put
    // it back explicitly before giving up.
    await client
      .query('alter table audit_logs enable trigger trg_audit_immutable')
      .catch(() => undefined);
    console.error('purge failed and was rolled back:', err.message);
    process.exitCode = 1;
  }

  if (!process.exitCode) {
    // Assert rather than assume, and prove the trigger is armed again.
    const left = await client.query(`select count(*)::int n from audit_logs where ${SURFACE}`);
    const armed = await client.query(
      `select count(*)::int n from pg_trigger where tgname = 'trg_audit_immutable' and tgenabled = 'O'`,
    );
    console.log(`audit rows remaining: ${left.rows[0].n}`);
    console.log(`append-only trigger re-armed: ${armed.rows[0].n === 1 ? 'yes' : 'NO'}`);
    if (left.rows[0].n !== 0 || armed.rows[0].n !== 1) process.exitCode = 1;
  }
  await client.end();
}
