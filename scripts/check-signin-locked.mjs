/**
 * PROVE a rate-limited account is not reported as a wrong password.
 *
 * WHY THIS IS A SCRIPT
 * --------------------
 * The classifier decides what a clinician is told at the moment they are most
 * likely to be in a hurry, and it reads three fields of an error object whose
 * shape `supabase-js` rewrites. That is precisely the kind of code that looks
 * right and is wrong in one direction, and the wrong direction here is the
 * expensive one: telling a locked-out user their password is wrong.
 *
 * It lives in `src/services/authFailure.ts` rather than `auth.ts` only because
 * `auth.ts` cannot be imported outside a bundler, so a test placed there could
 * not exist. Same reasoning as `passwordPolicy.ts`.
 *
 * WHAT IT PINS
 * ------------
 * Both directions, with the payloads this project actually returned when
 * measured against the live service:
 *
 *   - the 429 `over_request_rate_limit` a locked account gets is recognised
 *   - the 400 `invalid_credentials` a wrong password gets is not
 *   - the flattened form `supabase-js` hands the app is recognised, including the
 *     case where `code` is the number 429 rather than the string GoTrue sent
 *   - the message tells the person to wait and not to retry, since retrying is
 *     what keeps the account locked
 *
 * Run:  npm run db:check-signin-locked      (no credentials, no network)
 */
import { isRateLimited, MESSAGES, fail } from '../src/services/authFailure.ts';

let failures = 0;
const check = (label, pass, detail = '') => {
  if (!pass) failures++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

// Captured from the live service while a throwaway account was locked.
const GOTRE_BODY_LIMITED = {
  code: 429,
  error_code: 'over_request_rate_limit',
  msg: 'For security purposes, you can only request this after 60 seconds',
};
const GOTRE_BODY_WRONG = {
  code: 400,
  error_code: 'invalid_credentials',
  msg: 'Invalid login credentials',
};

console.log('A rate limit is recognised, from every shape it arrives in');

check('the status alone is enough', isRateLimited(429, undefined));
check('the raw GoTrue body is enough', isRateLimited(429, GOTRE_BODY_LIMITED));
check(
  'the raw body is recognised even without a 429 status',
  isRateLimited(200, GOTRE_BODY_LIMITED),
);
check(
  'a string error_code alone is enough',
  isRateLimited(undefined, { error_code: 'over_request_rate_limit' }),
);

// What supabase-js actually builds from the above. `code` is the *number* 429,
// not the string GoTrue sent, so a regex over `code` alone would miss it.
const FLATTENED = {
  message: 'For security purposes, you can only request this after 60 seconds',
  status: 429,
  code: 429,
};
check('the flattened supabase-js error is recognised', isRateLimited(429, FLATTENED));
check('a message-only signal is recognised', isRateLimited(400, FLATTENED));
check('an over_request_rate_limit code as a string is recognised',
  isRateLimited(undefined, { code: 'over_request_rate_limit' }));
check('"too many requests" wording is recognised',
  isRateLimited(undefined, { message: 'Too many requests' }));

console.log('\nA wrong password is NOT reported as a rate limit');

check('the raw wrong-password body is not a rate limit', !isRateLimited(400, GOTRE_BODY_WRONG));
check('its message alone is not a rate limit', !isRateLimited(400, GOTRE_BODY_WRONG.msg));
check(
  'the flattened wrong-password error is not a rate limit',
  !isRateLimited(400, { message: 'Invalid login credentials', status: 400, code: 400 }),
);
check('no error at all is not a rate limit', !isRateLimited(undefined, undefined));
check('a null error is not a rate limit', !isRateLimited(undefined, null));
check('a 500 is not a rate limit', !isRateLimited(500, { message: 'Internal server error' }));

console.log('\nWhat the person is told');

const limited = fail('too-many-attempts');
const wrong = fail('invalid-credentials');

check('a lockout does not claim the password is wrong',
  !/incorrect|wrong|is not right/i.test(limited.message), limited.message);
check('a lockout says the password is not the problem',
  /not the problem/i.test(limited.message));
check('a lockout tells them to wait',
  /wait/i.test(limited.message));
check('a lockout tells them to sign in once, not retry',
  /once/i.test(limited.message));
check('a real wrong password still reads as one',
  /incorrect/i.test(wrong.message), wrong.message);
check('a wrong password does not mention waiting',
  !/wait/i.test(wrong.message));
check('the two messages are different', limited.message !== wrong.message);
check('every failure reason has copy', (() => {
  const reasons = ['not-configured', 'invalid-credentials', 'too-many-attempts',
    'no-profile', 'inactive', 'unreachable'];
  return reasons.every((r) => typeof MESSAGES[r] === 'string' && MESSAGES[r].length > 10);
})());
check('no message leaks a password', (() => {
  const joined = Object.values(MESSAGES).join(' ');
  return !/SUPABASE_SERVICE_ROLE|service_role|eyJ[A-Za-z0-9]/.test(joined);
})());

console.log(
  failures === 0
    ? '\nA locked account is told to wait. A wrong password is still told it is wrong.'
    : `\n${failures} check(s) failed.`,
);
process.exitCode = failures === 0 ? 0 : 1;
