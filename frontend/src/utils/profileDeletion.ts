import { ApiError } from '@/api/auth'
import type { User } from '@/api/auth/types'
import { DATE_FORMATS, formatDate } from '@/utils/date'

/**
 * Writes the day a deletion with this wait would run: the day the wait ends, counted from the current
 * time in the user's zone, in the date format the app is set to
 *
 * @param waitSeconds - Seconds the deletion waits, above 0
 * @param timeZone - The user's zone, deciding which day the wait ends on
 * @param now - Instant to count from, overridable so tests can pin it
 */
export function formatDeletionDateAfterWait(waitSeconds: number, timeZone?: string, now = new Date()) {
  return formatDate(new Date(now.getTime() + waitSeconds * 1000), DATE_FORMATS.monthDayYear, timeZone)
}

/**
 * Writes the day a waiting deletion runs, from the due time the server sent, in the user's zone
 *
 * @param dueAt - The due time as an ISO string
 * @param timeZone - The user's zone, deciding which day the time falls on
 */
export function formatDeletionDueDate(dueAt: string, timeZone?: string) {
  return formatDate(new Date(dueAt), DATE_FORMATS.monthDayYear, timeZone)
}

// The server answers a cancel with this when the due time has passed, so the deletion has begun and can no
// longer be cancelled. Its detail says why
const DELETION_UNDER_WAY_STATUS = 409

/** Whether a failed cancel came too late, because the deletion has begun and the user's session is no use any more */
export function isCancelTooLate(error: unknown) {
  return error instanceof ApiError && error.status === DELETION_UNDER_WAY_STATUS
}

/** How a cancel ended: the user to hand back to the app, a refusal that came too late, or any other failure */
export type CancelOutcome =
  { kind: 'cancelled'; user: User } | { kind: 'too-late'; error: unknown } | { kind: 'failed'; error: unknown }

/**
 * Runs a cancel and says how it ended. A profile a second tab already cancelled answers like a cancel that
 * worked, with the user and no due time, so the app comes back and nothing signs out
 *
 * @param cancel - Sends the cancel and answers with the user
 */
export async function settleCancel(cancel: () => Promise<User>): Promise<CancelOutcome> {
  try {
    return { kind: 'cancelled', user: await cancel() }
  } catch (error) {
    return { kind: isCancelTooLate(error) ? 'too-late' : 'failed', error }
  }
}
