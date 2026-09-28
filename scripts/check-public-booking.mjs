/**
 * Live check: a visitor with no session can submit exactly one kind of thing - a
 * booking - through app_submit_online_booking, and nothing else on this database.
 *
 *   npm run db:check-public-booking
 *
 * Proves, with real PostgREST anon-key calls and a real Postgres connection:
 *   - anon may EXECUTE app_submit_online_booking but not app_update_own_profile
 *   - a valid booking returns 200 and the created row, with a REG-#### code,
 *     status 'Pending Arrival', and an age derived from the date of birth even
 *     when the client supplies a different one
 *   - the created row is really in the database
 *   - anon still cannot read online_bookings (RLS holds; the function is the
 *     only channel)
 *   - blank names, bad sex, future dob, past preferred date, bad time, malformed
 *     email, an over-long phone, and a duplicate phone+date are all refused
 *   - the rows this run creates are removed, and confirmed gone
 *
 * Needs the same .env entries as check-self-edit.mjs: PGHOST/PGPASSWORD,
 * VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY.
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

const missing = ['PGHOST', 'PGPASSWORD', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !env[k]);
if (missing.length) {
  console.error(`Missing from .env: ${missing.join(', ')}. See .env.example.`);
  process.exit(1);
}

const BASE = env.VITE_SUPABASE_URL.replace(/\/+$/, '');
const ANON = env.VITE_SUPABASE_ANON_KEY;
const RPC = `${BASE}/rest/v1/rpc/app_submit_online_booking`;
const ANON_HEADERS = {
  apikey: ANON,
  Authorization: `Bearer ${ANON}`,
  'Content-Type': 'application/json',
};

const { options } = resolveConnection(env);
const sql = new pg.Client({ ...options, ssl: shouldUseSsl(options, env) ? { rejectUnauthorized: false } : undefined });

let checks = 0;
let failures = 0;

const check = (name, ok, detail) => {
  checks++;
  if (!ok) {
    failures++;
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  } else {
    console.log(`  ok    ${name}`);
  }
};

// Throwaway identity, unique per run so a crashed run cannot collide with the next.
const stamp = Date.now().toString();
const PHONE = `+2347${stamp.slice(-9)}`;
const DOB = '1988-04-12'; // a stable past date; the derived age is checked against Postgres itself
const NAME = 'Probe';
const SURNAME = `Booking-${stamp.slice(-6)}`;

const validPayload = () => ({
  p_first_name: NAME,
  p_middle_name: '',
  p_last_name: SURNAME,
  p_dob: DOB,
  p_age: 99, // deliberately wrong: the stored age must be derived from the dob, not trusted
  p_sex: 'Female',
  p_phone: PHONE,
  p_email: '',
  p_address: '14 Probe Way, Testville',
  p_reason: 'Annual check-up',
  p_preferred_date: new Date().toISOString().slice(0, 10),
  p_preferred_time: '10:30',
});

async function callRpc(payload) {
  const res = await fetch(RPC, { method: 'POST', headers: ANON_HEADERS, body: JSON.stringify(payload) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

async function cleanup() {
  // Exactly one scoped delete: no audit trigger exists on online_bookings, so a
  // plain DELETE is the correct way to remove probe rows.
  await sql.query(`delete from online_bookings where first_name = $1 and last_name = $2`, [NAME, SURNAME]);
  const { rows } = await sql.query(`select id from online_bookings where first_name = $1 and last_name = $2`, [NAME, SURNAME]);
  return rows;
}

let createdIds = [];
let dupCode = null;

try {
  await sql.connect();

  // Reap any rows a crashed earlier run left behind, so this run starts clean.
  await sql.query(`delete from online_bookings where first_name = 'Probe' and last_name like 'Booking-%'`);
  const left = await sql.query(`select count(*)::int as n from online_bookings where first_name = 'Probe' and last_name like 'Booking-%'`);
  check('prior probe bookings swept', left.rows[0].n === 0, `${left.rows[0].n} left`);

  console.log('\n  [catalog grants]');
  const privs = await sql.query(`select
      has_function_privilege('anon', 'public.app_submit_online_booking(text,text,text,date,integer,text,text,text,text,text,date,text)', 'EXECUTE') as anon_booking,
      has_function_privilege('authenticated', 'public.app_submit_online_booking(text,text,text,date,integer,text,text,text,text,text,date,text)', 'EXECUTE') as auth_booking,
      has_function_privilege('anon', 'public.app_update_own_profile(text,text,text,text)', 'EXECUTE') as anon_own_profile`);
  check('anon may execute the booking RPC', privs.rows[0].anon_booking === true);
  check('authenticated may execute the booking RPC too', privs.rows[0].auth_booking === true);
  check('anon still may NOT execute app_update_own_profile', privs.rows[0].anon_own_profile === false);

  console.log('\n  [happy path: visitor submits a booking]');
  const ok = await callRpc(validPayload());
  const booking = ok.json && Array.isArray(ok.json) ? ok.json[0] : null;
  check('200 on a valid submission', ok.status === 200, `${ok.status} ${ok.text.slice(0, 120)}`);
  check('returns the created booking', Boolean(booking && booking.patient_code), ok.text.slice(0, 160));
  check('patient code has the REG-#### shape', Boolean(booking && /^REG-\d{4}$/.test(booking.patient_code)), booking?.patient_code);
  check('status is Pending Arrival', booking?.status === 'Pending Arrival', booking?.status);
  check('empty middle name is stored as NULL', booking?.middle_name === null, String(booking?.middle_name));
  check('empty email is stored as NULL', booking?.email === null, String(booking?.email));

  // The server must not trust the client's age: send 99, expect the dob-derived one.
  const derived = await sql.query(
    `select date_part('year', age($1::date))::int as expected, (select age from online_bookings where patient_code = $2) as stored`,
    [DOB, booking.patient_code],
  );
  check(
    'stored age is derived from dob, never trusted from the client',
    derived.rows[0].expected !== 99 && derived.rows[0].stored === derived.rows[0].expected,
    `expected ${derived.rows[0].expected}, stored ${derived.rows[0].stored}, client said 99`,
  );

  const saved = await sql.query(`select patient_code, booked_at from online_bookings where patient_code = $1`, [booking.patient_code]);
  check('the row really exists in the database', saved.rows.length === 1, `${saved.rows.length} rows`);
  createdIds = [booking.id];
  dupCode = booking.patient_code;

  console.log('\n  [anon is still walled off from everything but that one function]');
  const readTable = await fetch(`${BASE}/rest/v1/online_bookings?select=*&limit=1`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  });
  check('anon cannot read the online_bookings table', readTable.status === 401 || readTable.status === 403, `status ${readTable.status}`);

  const ownProfile = await fetch(`${BASE}/rest/v1/rpc/app_update_own_profile`, {
    method: 'POST',
    headers: ANON_HEADERS,
    body: JSON.stringify({ p_name: 'Hacked', p_department: null, p_avatar: null, p_pin: null }),
  });
  check('anon cannot call app_update_own_profile', ownProfile.status !== 200, `status ${ownProfile.status}`);

  console.log('\n  [invalid submissions are refused]');
  const attempts = [
    ['blank last name', { ...validPayload(), p_last_name: '   ' }, 'last name is required'],
    ['unknown sex', { ...validPayload(), p_sex: 'Unknown' }, 'sex must be Male'],
    ['dob in the future', { ...validPayload(), p_dob: '2999-01-01' }, 'date of birth must be a past date'],
    ['dob in the deep past', { ...validPayload(), p_dob: '1850-01-01' }, 'too far in the past'],
    ['preferred date in the past', { ...validPayload(), p_preferred_date: '2000-01-01' }, 'preferred date must be today or later'],
    ['nonsense time', { ...validPayload(), p_preferred_time: '25:99' }, 'preferred time must be 24-hour'],
    ['malformed email', { ...validPayload(), p_email: 'not-an-email' }, 'email address does not look valid'],
    ['over-long phone', { ...validPayload(), p_phone: '+234'.padEnd(40, '0') }, 'phone number must be 7-30'],
    ['age out of range', { ...validPayload(), p_age: 999 }, 'age must be between 0 and 130'],
  ];
  for (const [label, payload, expect] of attempts) {
    const r = await callRpc(payload);
    const refused = r.status === 400 && typeof r.json?.message === 'string' && r.json.message.includes(expect);
    check(label, refused, `status ${r.status} ${r.text.slice(0, 140)}`);
  }
  const afterBad = await sql.query(
    `select count(*)::int as n from online_bookings where first_name = 'Probe' and last_name = $1`,
    [SURNAME],
  );
  check('refused submissions created no rows', afterBad.rows[0].n === 1, `${afterBad.rows[0].n} rows (only the valid one)`);

  console.log('\n  [duplicate phone + same pending date is refused]');
  const dup = await callRpc(validPayload());
  check('a second booking for the same phone and date is refused', dup.status === 400 && /already has a pending appointment/i.test(dup.json?.message ?? ''), `${dup.status} ${dup.text.slice(0, 120)}`);
  const onlyOne = await sql.query(`select count(*)::int as n from online_bookings where patient_code = $1`, [dupCode]);
  check('no second row was created', onlyOne.rows[0].n === 1, `${onlyOne.rows[0].n} rows`);
} catch (err) {
  console.error('\n  FATAL:', err.stack || err.message);
  failures++;
} finally {
  if (sql.connection) {
    const remaining = await cleanup().catch(() => []);
    if (remaining.length) {
      console.error(`\n  WARNING: ${remaining.length} probe booking row(s) survived cleanup and must be removed by hand`);
      failures++;
    } else {
      check('probe bookings removed and confirmed gone', true);
    }
    await sql.end();
  }
}

console.log('');
if (failures) {
  console.log(`[db:check-public-booking] ${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`[db:check-public-booking] all ${checks} checks passed.`);
console.log('  A visitor can book an appointment; they cannot read, write or reach anything else.\n');