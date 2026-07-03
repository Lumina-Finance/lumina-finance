const RECOVERY_INTENT_KEY = 'mfa-recovery-intent'

/**
 * Records that the user is signing out specifically to recover a lost second factor, so the login page
 * can open in recovery mode once the session ends. Sign-out only clears auth state in memory, so this
 * session-scoped flag survives the handoff to the login page
 */
export function markRecoveryIntent(): void {
  sessionStorage.setItem(RECOVERY_INTENT_KEY, '1')
}

/**
 * Reads and clears the recovery-intent flag, returning whether this sign-in follows a recovery sign-out
 */
export function consumeRecoveryIntent(): boolean {
  const intended = sessionStorage.getItem(RECOVERY_INTENT_KEY) === '1'
  sessionStorage.removeItem(RECOVERY_INTENT_KEY)
  return intended
}
