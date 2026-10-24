import { readStoredValue, writeStoredValue } from '@/utils/browserStorage'

const STORAGE_KEY = 'lumina:reset_request_log'
const ROLLING_DAY_MS = 24 * 60 * 60 * 1000

const SIGNUP_STORAGE_KEY = 'lumina:signup_request_log'

/**
 * Records a reset-link request locally and returns how many this browser made in the rolling day
 *
 * Purely a courtesy signal so the confirmation screen can add guidance on repeat requests, the
 * backend enforces the real limits. Storage being unavailable simply reports a first request
 */
export function recordResetRequest(now = Date.now()): number {
  return recordRequest(STORAGE_KEY, now)
}

/**
 * Records a sign-up request locally and returns how many this browser made in the rolling day
 *
 * Counts requests whatever the address, so the browser keeps nothing that names one, and the
 * check-your-email screen can tell a repeat that the server may have capped
 */
export function recordSignupRequest(now = Date.now()): number {
  return recordRequest(SIGNUP_STORAGE_KEY, now)
}

function recordRequest(storageKey: string, now: number): number {
  let timestamps: number[] = []
  try {
    const stored = readStoredValue(storageKey)
    const parsed: unknown = stored ? JSON.parse(stored) : []
    if (Array.isArray(parsed)) timestamps = parsed.filter((entry): entry is number => typeof entry === 'number')
  } catch {
    return 1
  }
  const recent = timestamps.filter((timestamp) => now - timestamp < ROLLING_DAY_MS)
  recent.push(now)
  return writeStoredValue(storageKey, JSON.stringify(recent)) ? recent.length : 1
}
