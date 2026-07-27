import { LOCKOUT_KEY, getLockoutExpiry, getLockoutRemainingLabel } from '@/pages/auth/utils/authForm'

/**
 * Mirrors the backend's failed-login lockout in the browser, so a blocked user sees the wait time
 * immediately instead of only after a rejected request
 */
export function useAuthLockout() {
  /**
   * Returns the remaining local lockout time and clears expired lockout state
   */
  const getLockedRemaining = (): string | null => {
    const stored = localStorage.getItem(LOCKOUT_KEY)
    const remaining = getLockoutRemainingLabel(stored, Date.now())
    if (!remaining && stored) {
      localStorage.removeItem(LOCKOUT_KEY)
    }
    return remaining
  }

  /**
   * Starts a fresh local lockout window after the backend rejects a login for too many failed attempts
   */
  const recordLockout = (): void => {
    localStorage.setItem(LOCKOUT_KEY, String(getLockoutExpiry(Date.now())))
  }

  return { getLockedRemaining, recordLockout }
}
