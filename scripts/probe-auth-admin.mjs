/**
 * Probe the Auth admin API shapes this project actually implements, then clean up.
 *
 * The Edge Function has to call GoTrue's admin endpoints blind, and the surface
 * has moved between versions: user creation is POST /admin/users, but listing,
 * password updates and metadata updates have each changed method and query
 * syntax. Guessing wrong would ship a privileged endpoint that 404s in
 * production, which is the worst time to find out.
 *
 * So this asks the live project, records exactly what it answered, and deletes
 * every account it made. A probe that leaves junk behind is worse than no probe.
 *
 * Run:  node scripts/probe-auth-admin.mjs
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return i === -1 ? [l.trim(), ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const BASE = env.VITE_SUPABASE_URL;
const SR = env.SUPABASE_SERVICE_ROLE_KEY;
const probeEmail = `probe-authadmin-${Date.now()}@example.test`;

const created = new Set();
let failures = 0;
const check = (label, pass, detail = '') => {
  if (!pass) failures++;
  console.log(`  ${pass ? 'OK  ' : 'BAD '} ${label}${detail ? `  ${detail}` : ''}`);
};

/** One request. Returns status, parsed body, and the raw text when it is not JSON. */
async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      apikey: SR,
      Authorization: `Bearer ${SR}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON; the caller reads .text */
  }
  return { status: res.status, json, text };
}

async function main() {
  if (!BASE || !SR) throw new Error('VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env');
  console.log(`Probing Auth admin API as ${probeEmail}\n`);

  try {
    // --- create -------------------------------------------------------------
    const create = await call('/auth/v1/admin/users', {
      method: 'POST',
      body: { email: probeEmail, password: 'Probe-Pass-1!a', email_confirm: true },
    });
    check('POST /admin/users creates a user', create.status === 200 && !!create.json?.id,
      `status ${create.status}`);
    if (!create.json?.id) {
      console.log(`  body: ${create.text.slice(0, 300)}`);
      return;
    }
    const id = create.json.id;
    created.add(id);
    console.log(`  id: ${id}`);
    console.log(`  user_metadata on create: ${JSON.stringify(create.json.user_metadata)}`);

    // --- duplicate create must be refused, not silently merged --------------
    const dupe = await call('/auth/v1/admin/users', {
      method: 'POST',
      body: { email: probeEmail, password: 'Probe-Pass-1!a', email_confirm: true },
    });
    check('duplicate email is refused', dupe.status >= 400, `status ${dupe.status} ${dupe.json?.msg || dupe.json?.error_code || ''}`.trim());

    // --- lookup: is there a server-side email filter? -----------------------
    // Asserted as a KNOWN LIMITATION rather than skipped. If a future Supabase
    // upgrade makes ?filter= work, this check goes red and prompts a look at
    // whether the function's paging fallback is now redundant.
    const filtered = await call(
      `/auth/v1/admin/users?filter=${encodeURIComponent(`email.eq.${probeEmail}`)}`
    );
    const filterWorks =
      filtered.status === 200 &&
      Array.isArray(filtered.json?.users) &&
      filtered.json.users.some((u) => u.email === probeEmail);
    check('?filter= is still ignored (paging fallback is required)', !filterWorks,
      filterWorks ? 'filtering now works - recheck the paging fallback' : `status ${filtered.status}, 0 hits`);

    // --- the paging fallback, which is what the function will actually use ---
    const page = await call('/auth/v1/admin/users?page=1&per_page=1000');
    const viaPage =
      page.status === 200 &&
      (page.json?.users ?? []).some((u) => u.email === probeEmail);
    check('fallback: page through /admin/users', viaPage,
      `status ${page.status} users=${page.json?.users?.length ?? 'n/a'}`);
    console.log(`  auth accounts on this project: ${page.json?.users?.length ?? '?'}`);

    // --- set password. GoTrue never echoes a password back, so a 2xx is the
    //     only signal here; the authentication check below is the real proof.
    const putPwd = await call(`/auth/v1/admin/users/${id}`, {
      method: 'PUT',
      body: { password: 'Probe-Pass-2!a', user_metadata: { must_change_password: true } },
    });
    check('PUT /admin/users/:id {password, user_metadata}', putPwd.status === 200,
      `status ${putPwd.status}`);

    // --- PATCH is not routed on this project; record that so the function
    //     does not reach for it.
    const patchMeta = await call(`/auth/v1/admin/users/${id}`, {
      method: 'PATCH',
      body: { user_metadata: { must_change_password: true } },
    });
    console.log(`  note  PATCH /admin/users/:id -> ${patchMeta.status} (405 means PUT is the only verb)`);

    // --- a new password must actually authenticate --------------------------
    const signIn = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: probeEmail, password: 'Probe-Pass-2!a' }),
    });
    check('new password authenticates', signIn.status === 200, `status ${signIn.status}`);

    // --- lookup by id returns the metadata the app needs --------------------
    const byId = await call(`/auth/v1/admin/users/${id}`);
    check('user_metadata round-trips through PUT',
      byId.status === 200 && byId.json?.user_metadata?.must_change_password === true,
      `status ${byId.status} ${JSON.stringify(byId.json?.user_metadata)}`);
  } finally {
    // --- cleanup, unconditionally ------------------------------------------
    for (const id of created) {
      const del = await call(`/auth/v1/admin/users/${id}`, { method: 'DELETE' });
      console.log(`\ncleanup DELETE /admin/users/${id} -> ${del.status}`);
      if (del.status !== 200 && del.status !== 204) failures++;
    }
    // Belt and braces: if the create id was never captured, sweep by email.
    const sweep = await call(
      `/auth/v1/admin/users?filter=${encodeURIComponent(`email.eq.${probeEmail}`)}`
    );
    const strays = (sweep.json?.users ?? []).filter((u) => u.email === probeEmail);
    for (const u of strays) {
      await call(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' });
      console.log(`cleanup DELETE stray ${u.id}`);
    }
    console.log(strays.length === 0 ? 'probe accounts removed' : `${strays.length} stray account(s) found`);
  }

  console.log(failures === 0 ? '\nAuth admin API shape confirmed.' : `\n${failures} probe(s) did not behave as expected.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

await main();
