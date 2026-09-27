/**
 * PROVE that a signed-in user can rotate their own password, end to end.
 *
 * WHY THIS IS A SCRIPT AND NOT A UNIT TEST
 * ----------------------------------------
 * "User can change their password" is only true if Supabase Auth accepts the
 * write. A unit test against a stub would prove nothing, so this drives the real
 * auth API with a real session and a real account.
 *
 * WHAT IT PROVES
 * --------------
 *   1. `PUT /user {password}` with no one-time code is accepted   (self-service
 *      rotation needs no email, so nobody is locked out waiting on SMTP)
 *   2. the new password actually signs in
 *   3. the old password is refused afterwards
 *   4. the account is restored to the original credential, which then signs in
 *
 * The original password is read from STAFF_PASSWORD (never argv, never a
 * literal) and a temporary one is generated, rotated in, and rotated back out.
 * If the run dies between steps 2 and 3 the account holds the temporary
 * password, so the temporary is derived from the process and printed.
 *
 * Run:  npm run db:check-password
 */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return i === -1 ? [l.trim(), ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const URL_BASE = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const EMAIL = (env.STAFF_EMAIL || 'ernestoviosun@gmail.com').toLowerCase();
const ORIGINAL = process.env.STAFF_PASSWORD;

let failures = 0;
const check = (label, pass, detail = '') => {
  if (!pass) failures++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

/** POST/PUT a GoTrue route and return status + parsed-or-raw body. Never truncated. */
async function call(path, { method = 'POST', body, token } = {}) {
  const res = await fetch(`${URL_BASE}/auth/v1${path}`, {
    method,
    headers: {
      apikey: ANON,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json, text };
}

async function signIn(password) {
  const { status, json } = await call('/token?grant_type=password', {
    body: { email: EMAIL, password },
  });
  return { status, token: json.access_token };
}

const setPassword = (password, token) =>
  call('/user', { method: 'PUT', token, body: { password } });

async function main() {
  if (!URL_BASE || !ANON) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing from .env');
  if (!ORIGINAL) {
    console.log('STAFF_PASSWORD is not set in the environment. Nothing was changed.');
    process.exitCode = 1;
    return;
  }

  const temp = `Tmp-${randomBytes(9).toString('base64url')}!aA1`;
  console.log(`Rotating the password for ${EMAIL}`);
  console.log(`If this run is interrupted, the temporary password is: ${temp}\n`);

  const before = await signIn(ORIGINAL);
  check('original password signs in', before.status === 200, `status ${before.status}`);
  if (before.status !== 200) {
    console.log('\nCannot proceed: the original password does not work, so the');
    console.log('account cannot be restored by this script. Stopping.');
    process.exitCode = 1;
    return;
  }

  // 1. Self-service rotation, no nonce, no email.
  const rotate = await setPassword(temp, before.token);
  check(
    'PUT /user {password} accepted with no one-time code',
    rotate.status === 200,
    `status ${rotate.status} ${rotate.json?.msg || rotate.json?.error_code || ''}`.trim(),
  );

  // 2. The new password is the live one.
  const withTemp = await signIn(temp);
  check('new password signs in', withTemp.status === 200, `status ${withTemp.status}`);

  // 3. The old password is dead. This is the part that makes rotation a control
  //    rather than a formality: a leaked password stops working the moment it is
  //    changed.
  const withOld = await signIn(ORIGINAL);
  check('old password is refused', withOld.status === 400, `status ${withOld.status}`);

  // 4. Put it back, and prove the account is whole.
  let restored = null;
  if (withTemp.token) {
    const back = await setPassword(ORIGINAL, withTemp.token);
    restored = await signIn(ORIGINAL);
    check('original password restored and signs in', back.status === 200 && restored.status === 200,
      `restore ${back.status}, signin ${restored.status}`);
  } else {
    check('account restored', false, 'never obtained a session with the new password');
  }

  console.log(
    failures === 0
      ? '\nSelf-service password change works on this project: no email required.'
      : `\n${failures} check(s) failed.`
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

await main();
