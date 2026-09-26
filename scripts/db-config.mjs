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

const PLACEHOLDER = /\[YOUR-|YOUR-PASSWORD|your-ref|your_project|xxxxx|changeme/i;

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
