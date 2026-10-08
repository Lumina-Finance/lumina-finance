import type { BankHistoryReminder } from '@/api/bank-sync'
import { formatDateLabel } from '@/utils/date'

/** What a dismissal the server didn't answer says, while one it refused gives the server's reason */
export const DISMISS_FAILED_MESSAGE = 'The reminder could not be dismissed. Please try again.'

// Unverified, since a quiet account can simply have had no activity early on, so it says likely
const HISTORY_LIMIT_NOTE = 'This is likely a limit on how much history the bank keeps.'

export type ReminderCopy = { title: string; body: string }

/**
 * Labels a date with its spaces unbreakable, so a reminder on a phone never leaves the month on one
 * line and the day on the next
 */
function unbrokenDate(ymd: string): string {
  return formatDateLabel(ymd).replaceAll(' ', ' ')
}

/**
 * What the reminder says about an import or catch-up that returned less history than it asked for,
 * or none at all
 */
export function describeHistoryReminder(reminder: BankHistoryReminder, providerName: string): ReminderCopy {
  const requested = unbrokenDate(reminder.requested_start)
  if (reminder.earliest_returned === null) {
    return {
      title: 'No history returned yet',
      body: `${providerName} hasn't returned any transactions from ${requested} yet. ${HISTORY_LIMIT_NOTE}`,
    }
  }
  return {
    title: 'Less history than requested',
    body: `${providerName} returned transactions from ${unbrokenDate(reminder.earliest_returned)}, not ${requested}. ${HISTORY_LIMIT_NOTE}`,
  }
}
