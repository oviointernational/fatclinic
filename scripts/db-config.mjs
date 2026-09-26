/**
 * Resolve Postgres connection settings from the environment.
 *
 * Why this exists: a Supabase dashboard password frequently contains characters
 * that are reserved in a URI (`@`, `#`, `/`, `:`). Pasting it into a
 * postgresql:// URL truncates or mis-parses the string, and the failure looks
 * like a DNS error rather than a URL problem. Passing the parts separately
 * removes the encoding trap entirely, so that form is preferred.
 *
 *   1. PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE  (preferred, libpq names)
 *   2. DATABASE_URL                                        (fallback)
 *
 * Never logs a password. `describe()` returns a host:port/database label only.
 */
import { readFileSync } from 'node:fs';
import dns from 'node:dns';
import net from 'node:net';
import path from 'node:path';

const PLACEHOLDER = /\[YOUR-|YOUR-PASSWORD|your-ref|your_project|xxxxx|changeme/i;

/**
 * Resolve a hostname, falling back to a direct DNS query.
 *
 * `dns.lookup` goes through the OS resolver (getaddrinfo on Windows). For a host
 * that publishes only an AAAA record, Windows answers ENOENT even though the
 * record exists and PowerShell's Resolve-DnsName resolves it correctly.
 * `dns.resolve6` / `dns.resolve4` query the DNS server directly and bypass that
 * path.
 *
 * The hostname is returned unchanged whenever the normal lookup works, so TLS
 * SNI and pg_hba host matching still see db.<ref>.supabase.co. The IP fallback
 * engages only when there is no alternative, and the caller is told it happened
 * so it can be logged.
 *
 * @param {string} host
 * @returns {Promise<{ host: string, pinned: boolean, reason?: string }>}
 */
export async function resolveHost(host) {
  if (!host || net.isIP(host)) return { host, pinned: false };

  const viaLookup = await new Promise((resolve) => {
    dns.lookup(host, { all: true }, (err, addrs) => resolve(err ? null : addrs));
  });
  if (viaLookup && viaLookup.length) return { host, pinned: false };

  for (const family of [6, 4]) {
    const direct = await new Promise((resolve) => {
      const fn = family === 6 ? dns.resolve6 : dns.resolve4;
      fn(host, (err, addrs) => resolve(err ? null : addrs));
    });
    if (direct && direct.length) {
      return {
        host: direct[0],
        pinned: true,
        reason:
          `the OS resolver could not look up ${host} (it is IPv6-only, with no A ` +
          'record), so a direct DNS query was used instead',
      };
    }
  }

  // Nothing resolved: return the name unchanged and let the caller report it.
  return { host, pinned: false };
}

/**
 * Connect, retrying transient failures.
 *
 * Supabase's direct database host is IPv6-only on some projects (there is no A
 * record at all), and the route to it drops often enough that a single attempt
 * fails regularly. The schema is idempotent, so retrying is safe and much
 * cheaper than re-running by hand.
 *
 * Takes a factory rather than a Client because node-postgres marks a Client as
 * connected even after a failed connect, so a second connect() on the same
 * instance throws "Client has already been connected".
 *
 * @param {() => (Promise<import('pg').Client> | import('pg').Client)} makeClient
 * @param {{ attempts?: number, delayMs?: number, label?: string }} [opts]
 * @returns {Promise<import('pg').Client>} the connected client
 */
export async function connectWithRetry(makeClient, { attempts = 3, delayMs = 2000, label = 'connect' } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const client = await makeClient();
    try {
      await client.connect();
      if (attempt > 1) console.log(`[fatclinic] connected on attempt ${attempt}`);
      return client;
    } catch (err) {
      lastError = err;
      // A rejected password will not fix itself, so do not burn retries on it.
      if (/password authentication failed|role .* does not exist|pg_hba/i.test(err.message)) {
        client.end().catch(() => {});
        throw err;
      }
      if (attempt < attempts) {
        const wait = delayMs * attempt;
        console.log(
          `[fatclinic] ${label} attempt ${attempt} failed (${err.message.split('\n')[0]}), retrying in ${wait}ms`,
        );
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastError;
}

/**
 * dotenv strips an unquoted "#" onward as a comment, so a password containing
 * "#" is silently truncated. That produces a baffling "password authentication
 * failed" that looks like a wrong password rather than a parse error, so detect
 * the discrepancy and say so.
 *
 * @param {string} envPath
 * @param {string} key
 */
function assertNotTruncated(envPath, key) {
  let raw;
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    return; // No .env: values came from the real environment, not a file.
  }
  const line = raw.split(/\r?\n/).find((l) => l.trimStart().startsWith(`${key}=`));
  if (!line) return;

  const value = line.slice(line.indexOf('=') + 1).trim();
  // Quoted values are handled correctly by dotenv, including any "#".
  if (value.startsWith("'") || value.startsWith('"')) return;

  const at = value.indexOf('#');
  if (at < 0) return;

  throw new Error(
    `${key} in ${path.basename(envPath)} contains a "#" and is not quoted, so dotenv ` +
      'truncates it at that character and the connection fails with a misleading ' +
      '"password authentication failed".\n' +
      `  Wrap the value in single quotes: ${key}='...'`,
  );
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ options: object, label: string, source: 'parts' | 'url' }}
 */
export function resolveConnection(env = process.env) {
  const host = (env.PGHOST || '').trim();
  const password = env.PGPASSWORD || '';

  if (host || password || env.PGUSER || env.PGDATABASE) {
    if (!host) throw new Error('PGPASSWORD is set but PGHOST is missing.');
    if (!password) {
      throw new Error('PGHOST is set but PGPASSWORD is missing. Fill it in .env.');
    }
    assertNotTruncated(env.ENV_FILE || path.join(process.cwd(), '.env'), 'PGPASSWORD');
    if (PLACEHOLDER.test(password)) {
      throw new Error('PGPASSWORD still contains a placeholder.');
    }
    const port = Number((env.PGPORT || '5432').trim());
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`PGPORT is not a valid port number: ${env.PGPORT}`);
    }
    return {
      options: {
        host,
        port,
        user: (env.PGUSER || 'postgres').trim(),
        password,
        database: (env.PGDATABASE || 'postgres').trim(),
      },
      label: `${host}:${port}/${(env.PGDATABASE || 'postgres').trim()}`,
      source: 'parts',
    };
  }

  const url = (env.DATABASE_URL || '').trim();
  if (!url) {
    throw new Error(
      'No database connection configured. Set PGHOST and PGPASSWORD in .env ' +
        '(see .env.example), or DATABASE_URL as a fallback.',
    );
  }
  if (PLACEHOLDER.test(url)) {
    throw new Error('DATABASE_URL still contains a placeholder.');
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      'DATABASE_URL could not be parsed. Its password probably contains a ' +
        'character that is reserved in a URI (such as @ or #). Use the ' +
        'separate PGHOST / PGPASSWORD form instead.',
    );
  }
  if (!parsed.hostname.includes('.')) {
    throw new Error(
      `DATABASE_URL did not parse into a valid host (got "${parsed.hostname}"). ` +
        'Its password almost certainly contains an unescaped @ or #. Use the ' +
        'separate PGHOST / PGPASSWORD form instead.',
    );
  }

  return {
    options: {
      connectionString: url,
      host: parsed.hostname,
      port: Number(parsed.port || 5432),
      user: decodeURIComponent(parsed.username || 'postgres'),
      password: decodeURIComponent(parsed.password || ''),
      database: parsed.pathname.replace(/^\//, '') || 'postgres',
    },
    label: `${parsed.hostname}:${parsed.port || 5432}/${parsed.pathname.replace(/^\//, '')}`,
    source: 'url',
  };
}

/**
 * Decide whether to use TLS. On by default for anything that is not a local
 * socket; PG_SSL=true|false overrides.
 */
export function shouldUseSsl(options, env = process.env) {
  const override = String(env.PG_SSL || '').toLowerCase();
  if (override === 'true') return true;
  if (override === 'false') return false;
  const host = options.host || '';
  return !/^(localhost|127\.0\.0\.1|\[::1\]|\.internal$)/.test(host);
}
