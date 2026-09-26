// Which pooler region is this project in?
//
// A Supabase "direct" database host is very often IPv6-only, and a machine with
// no IPv6 route fails to connect with ENETUNREACH. The fix is the Session pooler,
// which is IPv4 - but the pooler hostname embeds the project region, and the
// dashboard is the only place that normally tells you which one it is.
//
// This script finds it by handshaking instead of by asking. Every
// aws-0-<region>.pooler.supabase.com name resolves over IPv4 (wildcard DNS), so
// DNS cannot narrow it down: each candidate has to be tried for real. Supavisor
// answers "tenant/user ... not found" for a region the project is not in, which
// is a clean negative, so a wrong guess costs one connection attempt and not a
// wrong answer.
//
// This matters because it is the difference between the db:* scripts running and
// the schema not being deployable. It does NOT affect the website: the browser
// reaches PostgREST over HTTPS on the project URL, which is IPv4 and needs no
// pooler. This is an admin-machine concern only.
//
//   node scripts/find-region.mjs              report the region
//   node scripts/find-region.mjs --write      also point .env at it
import 'dotenv/config';
import pg from 'pg';

// db.<ref>.supabase.co -> the ref is the FIRST label, not the second. Getting
// this wrong is silent and nasty: it connects as "postgres.supabase", which
// every region rejects as an unknown tenant, so the script reports "no region
// works" and blames the password.
const REF = (process.env.VITE_SUPABASE_URL || '')
  .replace(/^https?:\/\//, '')
  .split('/')[0]
  .split('.')[0];

if (!/^[a-z]{20}$/.test(REF)) {
  console.error(
    `Could not read a project ref from VITE_SUPABASE_URL (got "${REF}").\n`
    + 'Set it in .env - it looks like https://abcdefghijklmnopqrst.supabase.co',
  );
  process.exit(1);
}
if (!process.env.PGPASSWORD) {
  console.error('Set PGPASSWORD in .env - the pooler still needs the database password.');
  process.exit(1);
}

// Ordered by how often they come up in practice, so the common case exits after
// one or two attempts instead of walking the whole list.
const REGIONS = [
  'us-east-1', 'eu-west-2', 'eu-west-1', 'us-west-1', 'us-west-2',
  'ap-southeast-1', 'ap-southeast-2', 'eu-central-1', 'ap-south-1',
  'ap-northeast-1', 'ca-central-1', 'sa-east-1',
];
const PORTS = [5432, 6543]; // 5432 = session mode (can run DDL); 6543 = transaction

/**
 * One attempt, one fresh client. Never retry a client that may have connected:
 * pg throws "Client has already been connected" on the second connect(), which
 * would be reported as a failure for a connection that actually succeeded.
 */
async function tryOnce({ host, port }) {
  const client = new pg.Client({
    host,
    port,
    user: `postgres.${REF}`,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
    const { rows } = await client.query(
      "select current_setting('server_version') as version,"
      + ' current_user as usr, inet_server_addr()::text as addr',
    );
    return { ok: true, detail: rows[0] };
  } catch (e) {
    return { ok: false, detail: String(e.message || e).split('\n')[0] };
  } finally {
    // end() on a never-connected client throws; that would mask the real verdict.
    await client.end().catch(() => {});
  }
}

const found = [];
for (const region of REGIONS) {
  for (const port of PORTS) {
    const host = `aws-0-${region}.pooler.supabase.com`;
    const r = await tryOnce({ host, port });
    const label = `  ${region.padEnd(15)} :${port}`;
    if (r.ok) {
      console.log(`${label}  REACHABLE  server=${r.detail.version} as ${r.detail.usr} @ ${r.detail.addr}`);
      found.push({ host, port, region });
    } else {
      const quiet = /not found/i.test(r.detail);
      console.log(`${label}  ${quiet ? 'not this region' : r.detail.slice(0, 80)}`);
    }
    if (found.length) break; // one answer is enough; other regions are not ours
  }
  if (found.length) break;
}

if (!found.length) {
  console.log(
    '\nNo pooler region accepted the password. That is a credentials problem, not a\n'
    + 'region problem - check PGPASSWORD in .env. Remember to wrap it in single\n'
    + 'quotes, or an unquoted "#" silently truncates it.',
  );
  process.exit(1);
}

const [{ host, port, region }] = found;
console.log(`\nProject ${REF} is in ${region}.`);
console.log(`  PGHOST=${host}`);
console.log(`  PGPORT=${port}`);
console.log(`  PGUSER=postgres.${REF}`);

if (process.argv.includes('--write')) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const path = new URL('../.env', import.meta.url);
  const before = readFileSync(path, 'utf8');
  let after = before;
  const set = (k, v) => {
    const re = new RegExp(`^${k}=.*$`, 'm');
    after = re.test(after) ? after.replace(re, `${k}=${v}`) : `${after.trimEnd()}\n${k}=${v}\n`;
  };
  set('PGHOST', host);
  set('PGPORT', String(port));
  set('PGUSER', `postgres.${REF}`);
  if (after === before) console.log('\n.env already points here.');
  else {
    writeFileSync(path, after);
    console.log('\n.env updated. Re-run: npm run db:apply');
  }
}
