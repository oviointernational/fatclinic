/**
 * Tell the live PostgREST instance to reload its schema cache.
 *
 *   npm run db:reload-schema
 *
 * PostgREST caches the schema when it starts, so a table or function added by
 * `npm run db:apply` is not callable through the REST API until the cache is
 * rebuilt. `NOTIFY pgrst, 'reload schema'` is the programmatic equivalent of
 * Supabase dashboard -> Notifications -> Database -> Reload schema, and it is
 * needed after any apply that introduces a new object - most visibly a new RPC
 * such as app_submit_online_booking.
 *
 * Harmless to run at any time; does not change any data.
 */
import { readFileSync } from 'node:fs';
import { resolveConnection, shouldUseSsl } from './db-config.mjs';
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

const missing = ['PGHOST', 'PGPASSWORD'].filter((k) => !env[k]);
if (missing.length) {
  console.error(`Missing from .env: ${missing.join(', ')}. See .env.example.`);
  process.exit(1);
}

const { options } = resolveConnection(env);
const sql = new pg.Client({ ...options, ssl: shouldUseSsl(options, env) ? { rejectUnauthorized: false } : undefined });

try {
  await sql.connect();
  await sql.query("notify pgrst, 'reload schema'");
  console.log('[fatclinic] PostgREST schema cache reload requested.');
  console.log('            New tables and RPCs are now callable through the REST API.');
} catch (err) {
  console.error(`[fatclinic] reload failed: ${err.message}`);
  process.exit(1);
} finally {
  await sql.end();
}