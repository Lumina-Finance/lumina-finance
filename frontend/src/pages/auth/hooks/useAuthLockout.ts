import { LOCKOUT_KEY, getLockoutExpiry, getLockoutRemainingLabel } from '@/pages/auth/utils/authForm'
import { readStoredValue, removeStoredValue, writeStoredValue } from '@/utils/browserStorage'

/**
 * Mirrors the backend's failed-login lockout in the browser, so a blocked user sees the wait time
 * immediately instead of only after a rejected request
 */
export function useAuthLockout() {
  /**
   * Returns the remaining local lockout time and clears expired lockout state
   */
  const getLockedRemaining = (): string | null => {
    const stored = readStoredValue(LOCKOUT_KEY)
    const remaining = getLockoutRemainingLabel(stored, Date.now())
    if (!remaining && stored) {
      removeStoredValue(LOCKOUT_KEY)
    }
    return remaining
  }

  /**
   * Starts a fresh local lockout window after the backend rejects a login for too many failed attempts
   */
  const recordLockout = (): void => {
    writeStoredValue(LOCKOUT_KEY, String(getLockoutExpiry(Date.now())))
  }

  return { getLockedRemaining, recordLockout }
}
