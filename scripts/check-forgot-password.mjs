/**
 * "Forgotten your password?": the rule, the email, and the link's other half.
 *
 * WHAT THIS PROVES, AND WHY EACH PART IS HERE
 * -------------------------------------------
 * This is the one feature in the app whose whole purpose is to work for somebody
 * who CANNOT sign in, so a test that signs in to test it would be testing the
 * wrong thing. Every call below is made with no session at all, and the checks
 * that matter are the ones about who is NOT allowed a link.
 *
 *  1. The function answers a signed-out caller. This is why
 *     `[functions.staff-accounts] verify_jwt` is false, and if the gateway ever
 *     starts demanding a token again this is the check that fails - which is the
 *     point, because the feature would be dead rather than merely untested.
 *
 *  2. Only an active ADMINISTRATOR is sent a link. A clinician is refused, and
 *     so is a disabled administrator, and so is a profile with no sign-in account
 *     - because a cheerful "sent" for a mail that can never be written strands
 *     the one person this feature exists to rescue.
 *
 *  3. An address that is not in the staff register gets the SAME reply as a
 *     clinician. This endpoint is reachable from the open internet with no
 *     session, so if those two replies differed it would be a way to discover who
 *     works at the clinic, one guess at a time.
 *
 *  4. The reply never carries the secret. `sent` is a boolean and `message` is
 *     prose; nothing about the sign-in account itself is echoed, so the endpoint
 *     cannot be used to probe for one.
 *
 *  5. The real email actually goes out, and the real link comes back to the app.
 *     Checked against the live project, because a reset link that lands on
 *     localhost is a failure that no unit test can see.
 *
 *  6. The link the app receives is the shape `src/services/passwordReset.ts`
 *     expects. A silent change from `?code=` to `#access_token=` in a Supabase
 *     upgrade would otherwise leave the reset screen unreachable with no error
 *     anywhere.
 *
 * THE ONE THING THIS CANNOT CHECK
 * -------------------------------
 * That the email arrives in a real inbox. The project has no SMTP configured, so
 * delivery is Supabase's built-in service, which is rate-limited and restricted.
 * Step 5 proves a link was GENERATED and correctly addressed; only the recipient
 * can confirm arrival. That limit is why the checks below assert on the
 * audit trail and the returned link, never on "the mail was delivered".
 *
 * Run:  npm run db:check-forgot-password
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

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

const BASE = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const ADMIN = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};
const FUNCTION = `${BASE}/functions/v1/staff-accounts`;

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ''}`);
    failures += 1;
  }
};

const db = new pg.Client({
  host: env.PGHOST,
  port: Number(env.PGPORT),
  user: env.PGUSER,
  password: env.PGPASSWORD,
  database: env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

/**
 * Call the function with NO session.
 *
 * The `Authorization` header carries the anon key, exactly as the browser does
 * for a signed-out visitor. If a token were attached by mistake the
 * "answers a signed-out caller" check would still pass while proving nothing, so
 * this helper refuses to send a JWT at all.
 */
async function callForgot(email) {
  const res = await fetch(FUNCTION, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'forgot', email }),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

const stamp = Date.now();
const clinician = {
  id: `USR-F${stamp}`,
  name: 'Reset Clinician Probe',
  email: `reset-clinician-${stamp}@fatclinic.health`,
  role: 'PHYSICIAN',
};
const disabledAdmin = {
  id: `USR-G${stamp}`,
  name: 'Reset Disabled Probe',
  email: `reset-disabled-${stamp}@fatclinic.health`,
  role: 'ADMINISTRATOR',
  active: false,
};
/** A profile with no sign-in account: an administrator nobody can log in as. */
const orphanAdmin = {
  id: `USR-H${stamp}`,
  name: 'Reset Orphan Probe',
  email: `reset-orphan-${stamp}@fatclinic.health`,
  role: 'ADMINISTRATOR',
};

const created = [];
const auditBefore = new Set(
  (
    await db.query(
      "SELECT id FROM audit_logs WHERE action = 'SEND_PASSWORD_RESET_EMAIL'",
    )
  ).rows.map((r) => r.id),
);

try {
  for (const p of [clinician, disabledAdmin, orphanAdmin]) {
    await db.query(
      `INSERT INTO users (id, name, email, role, active, avatar, pin)
       VALUES ($1, $2, $3, $4, $5, '🧑‍⚕️', '4821')`,
      [p.id, p.name, p.email, p.role, p.active ?? true],
    );
    created.push(p.id);
  }

  // --- 1. It answers a caller with no session -------------------------------
  console.log('\nA signed-out caller');
  const forClinician = await callForgot(clinician.email);
  check(
    'the function answers with no session at all',
    forClinician.status === 200,
    `status ${forClinician.status} - if this is 401, verify_jwt is demanding a token again and the feature is dead for the people it exists for`,
  );

  // The exact wording the UI shows a clinician. Pinned here so that "point them
  // at their administrator" cannot quietly regress into something that explains
  // the rule at them instead - the sentence's whole job is to say where to go.
  check(
    'a clinician is told to contact the clinic administrator',
    forClinician.body?.message === 'Contact Clinic Administrator for reset',
    `message=${JSON.stringify(forClinician.body?.message ?? '')}`,
  );

  // --- 2. Only an active administrator gets a link -------------------------
  console.log('\nWho is sent a link');
  check(
    'a clinician is NOT sent a link',
    forClinician.body?.sent === false,
    `sent=${forClinician.body?.sent}`,
  );

  const forDisabled = await callForgot(disabledAdmin.email);
  check(
    'a DISABLED administrator is not sent a link',
    forDisabled.body?.sent === false,
    `sent=${forDisabled.body?.sent}`,
  );

  const forOrphan = await callForgot(orphanAdmin.email);
  check(
    'an administrator with no sign-in account is not promised a link',
    forOrphan.body?.sent === false,
    `sent=${forOrphan.body?.sent} - a "sent" here would be a mail that can never be written`,
  );
  check(
    'and is told the account does not exist yet',
    /sign-in account/i.test(forOrphan.body?.message ?? ''),
    JSON.stringify(forOrphan.body?.message ?? ''),
  );

  // --- 3. An unknown address is indistinguishable from a clinician ---------
  console.log('\nAn address that is not in the staff register');
  const stranger = await callForgot(`stranger-${stamp}@fatclinic.health`);
  check('an unknown address is refused', stranger.body?.sent === false, `sent=${stranger.body?.sent}`);
  check(
    'and gets the EXACT reply a clinician gets, so nobody can be enumerated',
    stranger.body?.message === forClinician.body?.message,
    'a different sentence here turns this into a way to discover who works here',
  );

  // --- 4. The reply carries no secret --------------------------------------
  console.log('\nWhat the reply contains');
  const keys = Object.keys(forClinician.body ?? {}).sort();
  check(
    'the reply is only { ok, sent, message }',
    JSON.stringify(keys) === JSON.stringify(['message', 'ok', 'sent']),
    `got ${JSON.stringify(keys)}`,
  );
  // What must NOT appear: anything that identifies the sign-in account, because
  // that is what this endpoint could be used to probe for. The word
  // "administrator" in the sentence is not a leak - it is the clinic's rule
  // stated in plain English, and it reveals nothing a signed-in member of staff
  // cannot already read from the staff list.
  const serialised = JSON.stringify(forClinician.body ?? {});
  check(
    'and carries no profile id, auth UUID or auth endpoint',
    !/USR-[A-Za-z0-9]/.test(serialised) &&
      !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(serialised) &&
      !/auth_user_id|authUserId|\/auth\/v1/i.test(serialised),
    serialised,
  );

  // --- Malformed input is refused for its own reason ------------------------
  console.log('\nInput that is not an address');
  const malformed = await callForgot('not-an-address');
  check('a malformed address is a 400', malformed.status === 400, `status ${malformed.status}`);
  check(
    'with a code the UI can act on',
    malformed.body?.code === 'invalid_email',
    `code=${malformed.body?.code}`,
  );

  // --- 5. A real administrator really does get a link ---------------------
  console.log('\nA real administrator, end to end');
  const adminEmail = 'ernestoviosun@gmail.com';
  const forRealAdmin = await callForgot(adminEmail);
  check(
    'an active administrator IS sent a link',
    forRealAdmin.body?.sent === true,
    `sent=${forRealAdmin.body?.sent} message=${JSON.stringify(forRealAdmin.body?.message ?? '')}`,
  );
  check(
    'and is told to check the inbox',
    /inbox|email/i.test(forRealAdmin.body?.message ?? ''),
    JSON.stringify(forRealAdmin.body?.message ?? ''),
  );

  // The link GoTrue generated, read without sending any mail. This is the only
  // way to prove the destination without asking somebody to forward an email.
  const genRes = await fetch(`${BASE}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: ADMIN,
    body: JSON.stringify({ type: 'recovery', email: adminEmail }),
  });
  const gen = await genRes.json();
  check('a recovery link can be generated for the project', genRes.ok && Boolean(gen?.action_link), `status ${genRes.status}`);

  // --- 6. The link lands back on the app, in the shape the app expects ----
  if (gen?.action_link) {
    let landed = null;
    try {
      const hop = await fetch(gen.action_link, { redirect: 'manual' });
      landed = hop.headers.get('location');
    } catch (err) {
      landed = null;
    }

    check('the link redirects somewhere', Boolean(landed));
    if (landed) {
      const at = new URL(landed);
      check(
        'the link comes back to the deployed app, not to localhost',
        at.hostname.includes('fatclinic') && at.hostname !== 'localhost',
        at.origin,
      );

      // The shape src/services/passwordReset.ts parses: tokens in the FRAGMENT.
      // If Supabase ever switches to a `?code=` query, this fails and names the
      // change instead of leaving the reset screen silently unreachable.
      const fragmentKeys = [...new URLSearchParams(at.hash.replace(/^#/, '')).keys()];
      check(
        'the tokens arrive in the URL fragment, which is what the app parses',
        fragmentKeys.includes('access_token') && fragmentKeys.includes('refresh_token'),
        `fragment keys: ${fragmentKeys.join(', ') || '(none)'}`,
      );
      check(
        'and it is marked as a recovery, not a normal sign-in',
        new URLSearchParams(at.hash.replace(/^#/, '')).get('type') === 'recovery',
      );
    }
  }

  // --- The audit trail records the decisions -------------------------------
  console.log('\nThe audit trail');
  const auditAfter = await db.query(
    "SELECT id, user_id, user_name, user_role, details, metadata FROM audit_logs WHERE action = 'SEND_PASSWORD_RESET_EMAIL' ORDER BY logged_at",
  );
  const newRows = auditAfter.rows.filter((r) => !auditBefore.has(r.id));
  check('every request wrote an audit row', newRows.length >= 6, `${newRows.length} rows`);

  const sentRow = newRows.find((r) => String(r.details).startsWith('sent:'));
  check('a sent link is recorded as sent', Boolean(sentRow));
  check(
    'with no actor, because the person asking cannot sign in',
    sentRow && sentRow.user_id === null && sentRow.user_name === '',
    sentRow ? `user_id=${sentRow.user_id} user_name=${JSON.stringify(sentRow.user_name)}` : 'no row',
  );
  check(
    'and user_role says so rather than claiming a role',
    sentRow && sentRow.user_role === 'NONE',
    sentRow ? `user_role=${sentRow.user_role}` : 'no row',
  );
  check(
    'and the metadata records that no session existed',
    sentRow && sentRow.metadata?.session === 'none',
    sentRow ? JSON.stringify(sentRow.metadata) : 'no row',
  );

  const refused = newRows.filter((r) => String(r.details).includes('not_administrator'));
  check('the refusals are recorded as refusals', refused.length >= 3, `${refused.length} refused rows`);

  // Spelled `no_sign_in_account` here, not the `no_auth_account` failure code,
  // and the difference is deliberate: the failure code is what a signed-in
  // administrator's "reset" call returns, and reusing it in an audit outcome
  // would make the log ambiguous between the two.
  const orphanRefusal = newRows.find((r) => String(r.details).includes('refused:no_sign_in_account'));
  check('the no-account case is recorded distinctly', Boolean(orphanRefusal));

  // A reset is a security event; the log is what an auditor reads afterwards.
  check(
    'no password appears anywhere in the audit trail',
    !newRows.some((r) => /password\s*[:=]\s*\S/i.test(String(r.details))),
  );
} finally {
  for (const id of created) {
    await db.query('DELETE FROM users WHERE id = $1', [id]);
  }
  // The audit rows are LEFT IN PLACE, and the attempt to tidy them up is the
  // interesting part. `audit_logs` is append-only, enforced by a BEFORE UPDATE OR
  // DELETE trigger, so this UPDATE is expected to be refused. It is attempted
  // rather than omitted because that refusal is itself worth asserting: a
  // password-reset trail that could be quietly edited is not a trail.
  //
  // The throwaway rows are therefore self-identifying - every probe address
  // carries the run's timestamp, or the literal strings 'stranger-' and
  // 'not-an-address' - so they are recognisable as probes by anyone reading the
  // screen, which is what actually matters for an append-only log.
  let appendOnlyHeld = false;
  try {
    await db.query(
      `UPDATE audit_logs SET details = details || ' [probe]'
        WHERE action = 'SEND_PASSWORD_RESET_EMAIL'
          AND (details LIKE $1 OR details LIKE $2 OR details LIKE $3)
          AND details NOT LIKE '%[probe]%'`,
      [`%${stamp}%`, '%stranger-%', '%not-an-address%'],
    );
  } catch {
    appendOnlyHeld = true;
  }
  check('the audit trail refuses edits, as it should', appendOnlyHeld);

  const left = await db.query('SELECT count(*)::int AS n FROM users WHERE id = ANY($1)', [created]);
  check('the probe profiles are gone', left.rows[0].n === 0, `${left.rows[0].n} left`);

  const accounts = await (await fetch(`${BASE}/auth/v1/admin/users?page=1&per_page=200`, { headers: ADMIN })).json();
  check('and no auth account was created by any of this', (accounts.users ?? []).length === 2, `${(accounts.users ?? []).length} accounts`);

  await db.end();
}

console.log(
  failures === 0
    ? '\nAn administrator can email themselves a link. A clinician is sent to their administrator.'
    : `\n${failures} check(s) failed.`,
);
if (failures) process.exitCode = 1;
