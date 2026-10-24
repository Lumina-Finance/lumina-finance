import { readStoredValue, removeStoredValue, writeStoredValue } from '@/utils/browserStorage'

const RECOVERY_INTENT_KEY = 'mfa-recovery-intent'

/**
 * Records that the user is signing out specifically to recover a lost second factor, so the login page
 * can open in recovery mode once the session ends. Sign-out only clears auth state in memory, so this
 * session-scoped flag survives the handoff to the login page
 */
export function markRecoveryIntent(): void {
  writeStoredValue(RECOVERY_INTENT_KEY, '1', 'session')
}

/**
 * Reads and clears the recovery-intent flag, returning whether this sign-in follows a recovery sign-out
 */
export function consumeRecoveryIntent(): boolean {
  const intended = readStoredValue(RECOVERY_INTENT_KEY, 'session') === '1'
  removeStoredValue(RECOVERY_INTENT_KEY, 'session')
  return intended
}
