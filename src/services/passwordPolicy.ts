/**
 * The password rules, in a form the browser can use.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Add Staff dialog writes the staff profile *before* it calls the Edge
 * Function, because the function needs a profile to link the credential to. That
 * ordering is deliberate, but it has a consequence: anything the function would
 * refuse must be caught here first, or the profile is already in the database and
 * the person is left with a staff record and no way to sign in. Nothing gets
 * registered when the details do not meet the requirements.
 *
 * The check is repeated rather than shared. The function's copy is the one that
 * counts - it runs next to the operation, and a form check can be bypassed with
 * the console - but sharing the file would mean bundling the privileged handler
 * into the browser, which is exactly what it exists to keep out of there. So the
 * two are pinned to each other by a test instead:
 *
 *   npm run db:check-staff-accounts
 *
 * which imports this module and handler.ts and asserts they return the same
 * verdict for the same input. Edit one without the other and that test fails.
 *
 * Keep the messages identical to the function's. They are what a clinician reads
 * when the server refuses, and two different sentences for one fault is worse
 * than either.
 */

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

/**
 * Passwords refused regardless of everything else.
 *
 * Not a full breach corpus, and not meant to be. The point is to reject the ones
 * people actually pick when told to choose something quickly, which pushes
 * anyone stricter towards writing it on the monitor - a worse outcome.
 */
const TOO_WEAK = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwertyuiop', 'letmein123', 'welcome123', 'admin1234', 'iloveyou123',
  'fatclinic', 'fatclinic123', 'solacemedicares', 'solacemedicares123',
  'clinic1234', 'hospital123',
]);

/**
 * Words of at least this length are treated as identifying. Below it, a name like
 * "Obi" or "Ana" would reject far too many reasonable passwords to be useful.
 */
const MIN_IDENTIFYING_WORD = 4;

/** Split a name into the parts worth refusing a password for. */
function identifyingWords(name: string | undefined | null): string[] {
  if (!name) return [];
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= MIN_IDENTIFYING_WORD);
}

/**
 * Every reason this password would be refused, in the order the function checks.
 *
 * A list rather than the first failure, so the dialog can show an administrator
 * everything that is wrong at once instead of one problem per attempt.
 */
export function passwordProblems(password: unknown, email: string, name?: string | null): string[] {
  const problems: string[] = [];

  if (typeof password !== 'string' || password.length === 0) {
    return ['Enter a password.'];
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    problems.push(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    // Bcrypt truncates at 72 bytes, so a long passphrase is silently weakened.
    problems.push(`The password must be at most ${MAX_PASSWORD_LENGTH} characters.`);
  }
  if (password !== password.trim()) {
    // Refused rather than trimmed: trimming would set a password other than the
    // one typed, and the mismatch would only surface as "I cannot sign in".
    problems.push('The password must not begin or end with a space.');
  }
  if (/\s/.test(password)) {
    problems.push('The password must not contain spaces.');
  }
  if (TOO_WEAK.has(password.toLowerCase())) {
    problems.push('That password is too common. Choose something less predictable.');
  }

  const localPart = (email ?? '').split('@')[0] ?? '';
  if (localPart.length >= MIN_IDENTIFYING_WORD && password.toLowerCase().includes(localPart.toLowerCase())) {
    problems.push('The password must not contain the staff email address.');
  }
  for (const word of identifyingWords(name)) {
    if (password.toLowerCase().includes(word)) {
      problems.push('The password must not contain the staff member’s name.');
      break;
    }
  }
  if (/^(.)\1+$/.test(password)) {
    problems.push('The password must not be a single repeated character.');
  }

  return problems;
}

/** The single reason to show, matching what the function returns first. */
export function checkStaffPassword(password: unknown, email: string, name?: string | null): string | null {
  return passwordProblems(password, email, name)[0] ?? null;
}

/** The rules, as sentences, for showing above the form. */
export const PASSWORD_RULES: string[] = [
  `At least ${MIN_PASSWORD_LENGTH} characters`,
  'No spaces anywhere',
  'Must not contain their name or email address',
  'Not a common password like "password123"',
  'Not the same character repeated',
];
