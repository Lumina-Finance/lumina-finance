import { ApiError } from '@/api/auth'
import { addDays, DATE_FORMATS, formatDate, getTodayDate } from '@/utils/date'

/**
 * Writes the day a deletion with this wait would run, counted from today in the user's zone, in the
 * date format the app is set to
 *
 * @param waitDays - Days the deletion waits, above 0
 * @param timeZone - The user's zone, deciding which day today is
 * @param now - Instant to count from, overridable so tests can pin it
 */
export function formatDeletionDateFromToday(waitDays: number, timeZone?: string, now?: Date) {
  return formatDate(addDays(getTodayDate(timeZone, now), waitDays), DATE_FORMATS.monthDayYear)
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

// The server answers a cancel with this once the due time has passed, when the deletion can no longer be cancelled
const DELETION_UNDER_WAY_STATUS = 409

/** Whether a failed cancel came too late, because the deletion has begun and the user's session is no use any more */
export function isCancelTooLate(error: unknown) {
  return error instanceof ApiError && error.status === DELETION_UNDER_WAY_STATUS
}
