// Self-test for scripts/db-config.mjs: the .env parsing guards and the host
// resolver fallback. Confirms that dotenv's "#" truncation is detected rather
// than silently producing a wrong password, and that resolveHost leaves a
// working hostname alone.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const cfg = path.join(ROOT, 'scripts', 'db-config.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fatclinic-env-'));

const cases = [
  {
    name: 'unquoted password containing # is rejected',
    env: 'PGHOST=db.example.supabase.co\nPGPASSWORD=abc#def@ghi\n',
    expect: /truncates it at that character/,
  },
  {
    name: 'DATABASE_URL containing # is reported clearly',
    env: 'DATABASE_URL=postgresql://postgres:a#b@db.abc.supabase.co:5432/postgres\n',
    expect: /reserved in a URI|did not parse into a valid host/,
  },
  {
    name: 'quoted password containing # is accepted',
    env: "PGHOST=db.example.supabase.co\nPGPASSWORD='abc#def@ghi'\n",
    expect: null,
    check: (r) => r.source === 'parts' && r.password === 'abc#def@ghi',
  },
  {
    name: 'placeholder password is rejected',
    env: 'PGHOST=db.example.supabase.co\nPGPASSWORD=[YOUR-DATABASE-PASSWORD]\n',
    expect: /placeholder/,
  },
  {
    name: 'missing PGPASSWORD is rejected',
    env: 'PGHOST=db.example.supabase.co\n',
    expect: /PGPASSWORD is missing/,
  },
  {
    name: 'no configuration at all is rejected',
    env: '',
    expect: /No database connection configured/,
  },
];

let failures = 0;
for (const c of cases) {
  const file = path.join(tmp, '.env');
  fs.writeFileSync(file, c.env);
  const probe = path.join(tmp, 'probe.mjs');
  fs.writeFileSync(
    probe,
    // The probe reproduces the real scripts: dotenv loads .env first, then
    // resolveConnection reads the result. Testing resolveConnection against
    // hand-built env objects would miss the dotenv truncation bug entirely.
    // createRequire resolves dotenv from the repo, so the probe can live in a
    // temp directory while still using the real parser.
    `import { createRequire } from 'node:module';\n` +
      `import { resolveConnection } from ${JSON.stringify(pathToFileURL(cfg).href)};\n` +
      `const require = createRequire(${JSON.stringify(path.join(ROOT, 'noop.cjs'))});\n` +
      `const dotenv = require('dotenv');\n` +
      `for (const k of ['PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','DATABASE_URL']) {\n` +
      `  delete process.env[k];\n` +
      `}\n` +
      `dotenv.config({ path: ${JSON.stringify(file)} });\n` +
      `try {\n` +
      `  const r = resolveConnection({ ...process.env, ENV_FILE: ${JSON.stringify(file)} });\n` +
      `  console.log('OK ' + JSON.stringify({ source: r.source, password: r.options.password ?? null }));\n` +
      `} catch (e) { console.log('ERR ' + e.message); }\n`,
  );

  let out = '';
  try {
    out = execFileSync(process.execPath, [probe], { encoding: 'utf8', env: { ...process.env } });
  } catch (err) {
    out = `${err.stdout || ''}${err.stderr || ''}`;
  }

  // On Windows an absolute path in an import specifier needs a file:// URL.
  if (/ERR_UNSUPPORTED_ESM_URL_SCHEME/.test(out)) {
    failures++;
    console.log(`  ${c.name.padEnd(48)} : FAILED`);
    console.log('      the probe could not import db-config.mjs (Windows path-as-URL)');
    continue;
  }

  let ok;
  if (c.expect) {
    ok = out.startsWith('ERR') && c.expect.test(out);
  } else {
    ok = out.startsWith('OK') && c.check(JSON.parse(out.slice(3)));
  }
  console.log(`  ${c.name.padEnd(48)} : ${ok ? 'ok' : 'FAILED'}`);
  if (!ok) {
    failures++;
    console.log(`      expected: ${c.expect ? c.expect : 'check() to pass'}`);
    console.log(`      got     : ${JSON.stringify(out.trim())}`);
  }
}

fs.rmSync(tmp, { recursive: true, force: true });

// --- resolveHost ------------------------------------------------------------
// The dangerous failure mode here is silent: if resolveHost pinned an address
// when it did not need to, TLS SNI and pg_hba host matching would see an IP
// instead of db.<ref>.supabase.co and the connection would fail in a way that
// looks like a server problem. So the cases below assert the hostname is
// returned untouched on every path that does not strictly require a fallback.
//
// The IP-pinning branch itself depends on a host that only Windows' resolver
// gets wrong, which cannot be manufactured portably, so it is not exercised
// here. What is checked is that the function is safe on the inputs it will
// actually see.
const { resolveHost } = await import(pathToFileURL(cfg).href);

const hostCases = [
  {
    name: 'IP literal is not looked up',
    input: '10.1.2.3',
    check: (r) => r.host === '10.1.2.3' && r.pinned === false,
    why: 'already an address; a DNS call would be wasted and could fail',
  },
  {
    name: 'IPv6 literal is not looked up',
    input: '::1',
    check: (r) => r.host === '::1' && r.pinned === false,
    why: 'net.isIP covers v6, which is the only family Supabase publishes here',
  },
  {
    name: 'empty host is passed through',
    input: '',
    check: (r) => r.host === '' && r.pinned === false,
    why: 'a Unix socket has no host; the caller reports the real error',
  },
  {
    name: 'resolvable name keeps the hostname',
    input: 'localhost',
    check: (r) => r.host === 'localhost' && r.pinned === false,
    why: 'the whole point: SNI and pg_hba must see the name, not an IP',
  },
  {
    name: 'unresolvable name is returned unchanged',
    input: 'no-such-host.invalid',
    check: (r) => r.host === 'no-such-host.invalid' && r.pinned === false,
    why: 'a bad name must still surface as a DNS error, not be replaced',
  },
];

for (const c of hostCases) {
  let result;
  let error = null;
  try {
    result = await resolveHost(c.input);
  } catch (err) {
    error = err;
  }
  const ok = !error && c.check(result);
  console.log(`  ${c.name.padEnd(48)} : ${ok ? 'ok' : 'FAILED'}`);
  if (!ok) {
    failures++;
    console.log(`      why     : ${c.why}`);
    console.log(`      got     : ${error ? `threw ${error.message}` : JSON.stringify(result)}`);
  }
}

console.log('');
if (failures) {
  console.log(`[db-config self-test] ${failures} failure(s)\n`);
  process.exit(1);
}
console.log('[db-config self-test] all cases behaved as expected\n');
