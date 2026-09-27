/**
 * How a staff account failure is turned into something worth reading.
 *
 * WHY THIS IS PURE
 * ----------------
 * The logic lives in src/services/staffAccountFailure.ts rather than in
 * staffAccounts.ts, because staffAccounts.ts imports the Supabase client and
 * Node cannot resolve that without a bundler. Splitting it out is what lets this
 * run with no network, no project and no credentials - so it can be part of
 * `npm run db:test` rather than something that only runs when somebody thinks to
 * run it against production.
 *
 * WHAT IS WORTH PINNING
 * ---------------------
 * One thing above all: a wrong recovery fact and an expired session both arrive
 * as 401. If the status is consulted before the code, somebody who cannot sign
 * in is told their session expired and to try again, which is the one piece of
 * advice that cannot possibly help them. Every other case here is a straight
 * mapping; that one is a decision.
 *
 * Run:  node scripts/check-account-failures.mjs
 */
import { readFileSync } from 'node:fs';
import { classifyStaffAccountFailure } from '../src/services/staffAccountFailure.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ''}`);
    failures += 1;
  }
};

const reason = (status, code, fallback = '') => {
  const r = classifyStaffAccountFailure(status, code, fallback);
  return r.ok ? 'ok' : r.reason;
};

console.log('\nThe collision that matters: 401 means two different things');
check(
  'a wrong recovery fact is not reported as an expired session',
  reason(401, 'invalid_recovery_details') === 'invalid_recovery_details',
  `got ${reason(401, 'invalid_recovery_details')}`,
);
check(
  'and neither is a malformed PIN, which shares the code',
  reason(400, 'invalid_recovery_details', 'The PIN is the four digits on your account screen.') ===
    'invalid_recovery_details',
);
check(
  'a genuinely expired session still is',
  reason(401, 'missing_token') === 'session-expired',
  `got ${reason(401, 'missing_token')}`,
);
check(
  'a 401 with no code at all is still an expired session',
  reason(401, undefined) === 'session-expired',
  `got ${reason(401, undefined)}`,
);
check(
  'a 401 from a body with no code is an expired session, not a recovery failure',
  reason(401, '', 'Sign in again.') === 'session-expired',
  `got ${reason(401, '', 'Sign in again.')}`,
);

console.log('\nThe message a locked-out person actually reads');
const recovery = classifyStaffAccountFailure(401, 'invalid_recovery_details', 'Those details do not match a staff account.');
check('the server sentence is passed through, not replaced', !recovery.ok && recovery.message === 'Those details do not match a staff account.');
check('it does not become "sign in again"', !/sign in again/i.test(recovery.message ?? ''), recovery.message);

const empty = classifyStaffAccountFailure(401, 'invalid_recovery_details', '   ');
check('an empty message still produces a sentence', Boolean(empty.ok === false && empty.message.trim().length > 0), JSON.stringify(empty));

console.log('\nEvery other mapping, unchanged');
const cases = [
  ['not_admin', 403, 'not_admin', 'This action is restricted to clinic administrators.', 'not-admin'],
  ['no_staff_profile', 404, 'no_staff_profile', 'There is no staff profile for that address.', 'no_staff_profile'],
  ['account_exists suggests reset', 409, 'account_exists', 'One already exists.', 'account_exists'],
  ['no_auth_account suggests create', 404, 'no_auth_account', 'No account yet.', 'no_auth_account'],
  ['invalid_email', 400, 'invalid_email', 'That email address is not valid.', 'invalid_email'],
  ['weak_password', 400, 'weak_password', 'Too short.', 'weak_password'],
  ['a 404 with no code means the function is not deployed', 404, undefined, undefined, 'function-missing'],
  ['a 403 with no code means not an administrator', 403, undefined, 'no', 'not-admin'],
  ['anything else is unreachable', 500, 'something_new', 'Upstream is unwell.', 'unreachable'],
  ['a network failure is unreachable', undefined, undefined, '', 'unreachable'],
];
for (const [label, status, code, fallback, want] of cases) {
  check(label, reason(status, code, fallback) === want, `got ${reason(status, code, fallback)}`);
}

console.log('\nThe suggestions that save the administrator a round trip');
const exists = classifyStaffAccountFailure(409, 'account_exists', 'One already exists.');
const missing = classifyStaffAccountFailure(404, 'no_auth_account', 'No account yet.');
check('an existing account suggests reset rather than a second create', !exists.ok && exists.suggests === 'reset');
check('a missing account suggests create', !missing.ok && missing.suggests === 'create');
check('a wrong recovery fact suggests nothing, because it is not the wrong operation', classifyStaffAccountFailure(401, 'invalid_recovery_details', 'x').suggests === undefined);

console.log('\nA missing deployment is still actionable');
const notDeployed = classifyStaffAccountFailure(404, undefined, '');
check('it names the deploy command', /supabase functions deploy staff-accounts/.test(notDeployed.ok ? '' : notDeployed.message), notDeployed.ok ? 'ok' : notDeployed.message);

console.log('\nThe client never invents or edits the sentence it is given');
const passthrough = classifyStaffAccountFailure(500, 'something_new', 'Upstream is unwell.');
check('an unknown code passes the server sentence through unchanged', !passthrough.ok && passthrough.message === 'Upstream is unwell.');
check(
  'and a refusal never has a sentence appended to it',
  !/hunter2|Untitled/.test([recovery, exists, notDeployed].map((r) => (r.ok ? '' : r.message)).join(' ')),
);

/*
 * A message that reached the browser can only leak a password if the function
 * put one there, so that is where the guarantee has to be checked. The client
 * cannot help: it is handed a finished sentence and has no way to recognise a
 * credential in prose. This looks at the source rather than trusting the
 * argument that the messages are all literals.
 */
const handler = readFileSync(new URL('../supabase/functions/staff-accounts/handler.ts', import.meta.url), 'utf8');
// Comments are stripped first, and not as a nicety: the audit writer's own
// comment explains at length why it does not log a password, so a naive search
// for the word finds the explanation and calls it a leak.
const code = handler.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const messageValues = [...code.matchAll(/message:\s*([^\n,]+)/g)].map((m) => m[1]);
check('the handler has messages to check', messageValues.length > 5, `${messageValues.length} found`);
const leaky = messageValues.filter((v) => /\$\{[^}]*pass/i.test(v));
check(
  'no message in the function interpolates anything password-shaped',
  leaky.length === 0,
  leaky.join(' | '),
);

// Anchored on real code, not on the section comment: the comments have just been
// stripped, so a marker like "// --- Operations" no longer exists and indexOf
// would quietly return -1 and slice to the end of the file. That mistake made
// this check report opCreate's legitimate `body.password` as an audit leak.
const auditBody = code.slice(
  code.indexOf('async function audit('),
  code.indexOf('async function opCreate('),
);
// Not "does the word appear" - the details string legitimately reads
// "(no session: password recovery)". The risk is writing a credential *value*
// into a row every member of staff can read, which can only happen by
// interpolating one.
check(
  'the audit writer interpolates no password-shaped value into a staff-readable row',
  !/\$\{[^}]*pass/i.test(auditBody) && !/\.password\b/.test(auditBody),
  auditBody.match(/\$\{[^}]*pass[^}]*\}/i)?.[0] ?? auditBody.match(/.*\.password\b.*/)?.[0]?.trim(),
);
check(
  'and it does write the session marker, so an unattributed reset is visible afterwards',
  /session:\s*actor\s*\?\s*'signed-in'\s*:\s*'none'/.test(auditBody),
);

console.log(
  failures === 0
    ? '\nA wrong recovery fact and an expired session never read the same.'
    : `\n${failures} check(s) failed.`,
);
if (failures) process.exitCode = 1;
