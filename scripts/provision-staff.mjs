#!/usr/bin/env node
/**
 * Create or repair a staff sign-in account.
 *
 * WHY THIS IS A SCRIPT AND NOT A SCREEN
 * -------------------------------------
 * Making an account needs the Supabase `service_role` key, which bypasses RLS
 * entirely. The only safe place for that key is a machine an administrator
 * controls - so provisioning is a command, and the app's "add staff" screen only
 * ever creates the *profile* row, then prints the command to run.
 *
 * The alternative, an in-app form, would mean either shipping the key to every
 * browser (where it is readable by anyone who opens devtools, and would grant
 * them the whole patient table) or standing up a server to proxy it. Neither is
 * acceptable for clinical records, so this is the design rather than a
 * workaround for one.
 *
 * The key is read from the environment and never echoed, never written to a
 * file, and never passed as an argument where it would land in shell history.
 *
 * USAGE
 * -----
 *   # First administrator. Creates the auth account and the profile together.
 *   npm run staff:add -- \
 *     --name "Dr. Sarah Alabi" \
 *     --email alabi@fatclinic.health \
 *     --role ADMINISTRATOR \
 *     --password 'choose-something-long'
 *
 *   # A profile that already exists (created in the app's admin screen).
 *   npm run staff:add -- --link USR-003 --password '...'
 *
 *   # Reset a forgotten password.
 *   npm run staff:add -- --link USR-003 --password '...'
 *
 *   # Disable an account. Leaves the profile (and its audit history) intact.
 *   npm run staff:add -- --disable USR-003
 *
 * FLAGS
 * -----
 *   --name        Full name and title. Required unless --link is given.
 *   --email       Staff address, stored lowercase. Required unless --link.
 *   --role        One of the nine roles in the users table CHECK constraint.
 *   --department  Free text. Optional.
 *   --pin         4-digit workstation screen-lock PIN. Optional, defaults 1234.
 *   --password    The sign-in password. Omit to have one generated and printed.
 *   --link        Existing public.users id: create or reset its sign-in account.
 *   --disable     Mark the profile inactive and revoke its auth account.
 *   --list        Show every profile and whether it can sign in.
 *   --dry-run     Report what would change. Touches nothing.
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

loadEnv();

const ROLES = [
  'ADMINISTRATOR', 'PHYSICIAN', 'NURSE', 'LAB_SCIENTIST', 'PHARMACIST',
  'RADIOLOGIST', 'PHYSIOTHERAPIST', 'FRONT_DESK', 'BILLING_OFFICER',
];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'database', 'fatclinic.sql'), 'utf8');

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const say = (...a) => console.log(...a);
const ok = (m) => say(`${C.green}OK${C.reset}   ${m}`);
const warn = (m) => say(`${C.yellow}!!${C.reset}   ${m}`);
const die = (m) => { say(`${C.red}FAIL${C.reset} ${m}`); bail(1); };

/**
 * Stop without calling process.exit().
 *
 * process.exit() aborts with 0xC0000409 on Windows when supabase-js still holds
 * a socket: libuv trips an assertion in src\win\async.c while tearing the
 * handle down. The command has already done its job, but the exit code reports a
 * crash - and for --link, which prints a password once, that is bad enough to
 * make people re-run it. Setting exitCode and returning lets the event loop
 * drain, which returns the right code because undici's sockets are unref'd.
 */
class Stop extends Error {}
function bail(code) { process.exitCode = code; throw new Stop(); }

// --- arguments ---------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    if (key === 'list' || key === 'dry-run' || key === 'help') { out[key] = true; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) die(`--${key} needs a value`);
    out[key] = next;
    i += 1;
  }
  return out;
}

async function main() {
const args = parseArgs(process.argv.slice(2));

/** The header comment, reused as the help text so the two cannot disagree. */
const usage = () =>
  readFileSync(fileURLToPath(import.meta.url), 'utf8')
    .split('*/')[0]
    .replace(/^#![^\n]*\n/, '')
    .replace(/^\/\*\*?\n?/, '')
    .replace(/^ \* ?/gm, '')
    .trimEnd();

if (args.help || (!args.link && !args.email && !args.list)) {
  say(usage());
  if (!args.help) say('\nRun with --help for the full reference.\n');
  bail(args.help ? 0 : 1);
}

// --- environment -------------------------------------------------------------

const url = (process.env.VITE_SUPABASE_URL || '').trim();
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!url) {
  die('VITE_SUPABASE_URL is not set. Add it to .env (Project Settings -> API).');
}
if (!serviceKey) {
  say('');
  say('SUPABASE_SERVICE_ROLE_KEY is not set, and it is needed: creating an account');
  say('bypasses Row Level Security, so the anon key cannot do it.');
  say('');
  say('  1. Supabase dashboard -> Project Settings -> API');
  say('  2. "service_role" -> Reveal -> copy');
  say('  3. .env:  SUPABASE_SERVICE_ROLE_KEY=\'paste-it-here\'');
  say('');
  say('Keep it out of git. .env is already ignored; never commit it or paste it into chat.');
  say('The service_role key is a full bypass of every access rule in this database.');
  bail(1);
}

// A JWT, so an obviously wrong value fails here with a clear message instead of
// surfacing later as "permission denied for table users".
if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(serviceKey)) {
  die('SUPABASE_SERVICE_ROLE_KEY does not look like a JWT. Copy the whole "service_role" value, not the anon key.');
}

const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const nextStaffId = async () => {
  const { data, error } = await db.from('users').select('id').like('id', 'USR-%');
  if (error) die(`could not read users: ${error.message}`);
  const highest = (data ?? []).reduce((max, r) => {
    const n = Number(String(r.id).replace(/\D/g, ''));
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `USR-${String(highest + 1).padStart(3, '0')}`;
};

const isDryRun = Boolean(args['dry-run']);

// --- list --------------------------------------------------------------------

if (args.list) {
  const { data, error } = await db.from('users').select('id,name,email,role,active,auth_user_id').order('id');
  if (error) die(`could not read users: ${error.message}`);
  if (!data?.length) {
    say('\nNo staff profiles exist yet. Create the first administrator:\n');
    say('  npm run staff:add -- --name "..." --email ... --role ADMINISTRATOR\n');
    return;
  }
  say('');
  say(`${C.bold}ID       NAME                     EMAIL                      ROLE             CAN SIGN IN${C.reset}`);
  for (const u of data) {
    const linked = u.auth_user_id ? 'yes' : 'no  (no auth account)';
    const can = u.active ? linked : 'no  (profile disabled)';
    const tint = can.startsWith('yes') ? C.green : C.yellow;
    say(
      `${u.id.padEnd(8)} ${String(u.name).slice(0, 24).padEnd(24)} ` +
      `${String(u.email).slice(0, 27).padEnd(27)} ${u.role.padEnd(16)} ${tint}${can}${C.reset}`
    );
  }
  say('');
  return;
}

// --- disable -----------------------------------------------------------------

if (args.disable) {
  const id = String(args.disable);
  const { data: profile, error: readErr } = await db
    .from('users').select('id,name,email,auth_user_id,active').eq('id', id).maybeSingle();
  if (readErr) die(`could not read ${id}: ${readErr.message}`);
  if (!profile) die(`no staff profile with id ${id}. Try --list.`);

  if (isDryRun) {
    say(`\n${C.bold}DRY RUN${C.reset} would disable ${profile.name} <${profile.email}> and revoke its sign-in.`);
    say('The profile row is kept, so its audit history stays attributable.\n');
    return;
  }

  const { error: updErr } = await db.from('users').update({ active: false }).eq('id', id);
  if (updErr) die(`could not disable ${id}: ${updErr.message}`);

  // Revoke the credential too. Disabling the profile alone would leave a working
  // password in the wild: the RLS helper returns NULL for an inactive account, so
  // the admin tables close, but the clinical tables are `USING (true)` and would
  // still accept writes from anyone holding that JWT.
  if (profile.auth_user_id) {
    const { error: banErr } = await db.auth.admin.deleteUser(profile.auth_user_id);
    if (banErr) warn(`profile disabled, but the auth account could not be deleted: ${banErr.message}`);
  }

  ok(`${profile.name} can no longer sign in. The profile and its audit history are intact.`);
  return;
}

// --- create or link ----------------------------------------------------------

let email = (args.email || '').trim().toLowerCase();
const password = args.password || randomBytes(12).toString('base64url');
const generated = !args.password;

if (args.link) {
  const id = String(args.link);
  const { data: profile, error } = await db
    .from('users').select('*').eq('id', id).maybeSingle();
  if (error) die(`could not read ${id}: ${error.message}`);
  if (!profile) {
    die(`no staff profile with id ${id}. Create the profile in the app's admin screen first, then re-run with --link ${id}.`);
  }
  // The profile is the source of truth for the address. Taking it from there
  // rather than from a flag removes the chance of linking an account to an
  // address the profile does not have, which would authenticate successfully and
  // then fail the profile lookup at sign-in.
  const profileEmail = String(profile.email).toLowerCase();
  if (email && email !== profileEmail) {
    die(`--email ${email} does not match the profile (${profileEmail}). Omit --email when using --link.`);
  }
  if (!profile.active) {
    die(`${profile.name} is disabled. Re-enable the profile before creating a sign-in account.`);
  }
  email = profileEmail;
  say('');
  say(`Linking a sign-in account to ${C.bold}${profile.name}${C.reset} <${email}>`);
} else {
  if (!args.name) die('--name is required (or use --link with an existing profile id).');
  if (!email) die('--email is required (or use --link with an existing profile id).');
  if (!args.role) die('--role is required. One of: ' + ROLES.join(', '));
  if (!ROLES.includes(args.role)) die(`--role ${args.role} is not valid. One of: ${ROLES.join(', ')}`);
  if (/\s/.test(email) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) die(`--email "${email}" is not a valid address.`);
  if (password.length < 8) die('The password must be at least 8 characters.');

  // The users table checks the PIN shape, so fail here with a clear message
  // rather than letting the insert be rejected by a constraint.
  const pin = args.pin || '1234';
  if (!/^\d{4}$/.test(pin)) die(`--pin must be exactly 4 digits (got "${pin}").`);

  // The role list above is duplicated in the schema's CHECK constraint. If the two
  // ever drift, this catches it before a clinician is told a role that will be
  // rejected on insert.
  const schemaRoles = sql.match(/role\s+TEXT\s+NOT NULL\s+CHECK\s*\(role\s+IN\s*\(([\s\S]*?)\)\)/);
  if (schemaRoles) {
    const fromSchema = [...schemaRoles[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
    if (fromSchema.join(',') !== [...ROLES].sort().join(',')) {
      die(
        'The role list in this script has drifted from the CHECK constraint in ' +
        'database/fatclinic.sql.\n' +
        `  script: ${ROLES.sort().join(', ')}\n` +
        `  schema: ${fromSchema.join(', ')}`
      );
    }
  }

  const id = await nextStaffId();

  if (isDryRun) {
    say(`\n${C.bold}DRY RUN${C.reset} would create:`);
    say(`  id         ${id}`);
    say(`  name       ${args.name}`);
    say(`  email      ${email}`);
    say(`  role       ${args.role}`);
    say(`  department ${args.department || '(none)'}`);
    say(`  pin        ${pin}   ${C.dim}(workstation screen lock, not a credential)${C.reset}`);
    say(`  password   ${generated ? '(generated at run time)' : '(from --password)'}\n`);
    return;
  }

  const { error: insErr } = await db.from('users').insert({
    id,
    name: args.name,
    email,
    role: args.role,
    department: args.department || '',
    avatar: '',
    pin,
    active: true,
  });
  if (insErr) die(`could not create the profile: ${insErr.message}`);
  ok(`profile ${id} created (${args.name} <${email}>)`);

  args.link = id;
}

const targetId = String(args.link);

if (isDryRun) {
  say(`\n${C.bold}DRY RUN${C.reset} would create a Supabase Auth account for ${targetId} and link it.\n`);
  return;
}

// Does an auth user already exist for this address? Supabase enforces uniqueness
// on the address itself, so this has to be checked before createUser, or a
// re-run fails with an opaque 422.
const { data: existingList, error: listErr } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
if (listErr) die(`could not list auth users: ${listErr.message}`);
const existing = (existingList?.users ?? []).find(
  (u) => String(u.email ?? '').toLowerCase() === email
);

let authUserId;
if (existing) {
  // Re-linking an account whose profile exists is a repair, not a creation. The
  // `users` table checks the role first, so an invalid role fails before the
  // password is touched rather than after.
  if (!ROLES.includes(args.role)) {
    const { data: p } = await db.from('users').select('role').eq('id', targetId).maybeSingle();
    if (p && !ROLES.includes(p.role)) {
      die(`profile ${targetId} has role ${p.role}, which is not in the schema's CHECK constraint. Fix the data before resetting a password.`);
    }
  }
  const { error: updErr } = await db.auth.admin.updateUserById(existing.id, {
    password,
    email_confirm: true,
  });
  if (updErr) die(`could not reset the password for ${email}: ${updErr.message}`);
  authUserId = existing.id;
  ok(`password reset for the existing account ${email}`);
} else {
  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr) die(`could not create the auth account: ${createErr.message}`);
  authUserId = created.user.id;
  ok(`auth account created for ${email}`);
}

const { error: linkErr } = await db
  .from('users')
  .update({ auth_user_id: authUserId })
  .eq('id', targetId);
if (linkErr) {
  warn(`the account works, but auth_user_id could not be written: ${linkErr.message}`);
  warn('sign-in is matched on email, so this does not block access. Re-run to fix it.');
} else {
  ok(`auth_user_id linked on ${targetId}`);
}

say('');
if (generated) {
  say(`${C.bold}Generated password for ${email}:${C.reset}`);
  say(`  ${C.cyan}${C.bold}${password}${C.reset}`);
  say('');
  warn('It is shown once and was not stored. Give it to the staff member over a channel');
  warn('that is not this terminal, and have them change it after signing in.');
} else {
  say(`${C.bold}${email} can now sign in.${C.reset}`);
}
say('');
say('They sign in with the email above. The workstation PIN is a screen lock, not a');
say('credential, and does not need to match the password.');
say('');
}

// No process.exit() above, deliberately - see the bail() comment. A genuine
// unexpected throw is a bug and must stay loud, so it is rethrown, not swallowed.
main().catch((e) => {
  if (e instanceof Stop) return;
  throw e;
});
