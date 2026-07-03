import { ApiError } from '@/api/auth';

/**
 * Returns the step-up attempts left before the shared lockout, or null when the error does not carry it
 *
 * Only the credential-failure step-up 401s report the count, so a plain failure or a passkey ceremony
 * error yields null and the caller falls back to its generic message
 */
export function getAttemptsRemaining(error: unknown): number | null {
  if (error instanceof ApiError && typeof error.attemptsRemaining === 'number') {
    return error.attemptsRemaining;
  }
  return null;
}

/**
 * Builds the neutral step-up failure message shown when a credential check comes back rejected
 *
 * The backend never says whether the password or the factor was wrong, to deny a brute-force oracle, so
 * the copy names both possibilities without pointing at either. With no factor present only the password
 * could have failed, so it is named alone
 */
export function describeStepUpFailure(factor: 'code' | 'passkey', passwordOnly: boolean): string {
  if (passwordOnly) {
    return 'Your password was incorrect.';
  }
  return `Your password or ${factor} was incorrect.`;
}

/**
 * Builds the warning shown after a failed step-up, counting down to the lockout that signs the user out
 *
 * Zero means the failure just tripped the lock, so the wording shifts from a countdown to the outcome
 */
export function buildLockoutWarning(attemptsRemaining: number): string {
  if (attemptsRemaining <= 0) {
    return "Your account is now locked and you've been signed out everywhere.";
  }
  const attempts = attemptsRemaining === 1 ? '1 attempt' : `${attemptsRemaining} attempts`;
  return `${attempts} remaining before your account is locked and you're signed out everywhere.`;
}
