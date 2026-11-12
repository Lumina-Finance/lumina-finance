import type { BankHistoryReminder } from '@/api/bank-sync'
import { formatDateLabel } from '@/utils/date'

/** What a dismissal the server didn't answer says, while one it refused gives the server's reason */
export const DISMISS_FAILED_MESSAGE = 'The reminder could not be dismissed. Please try again.'

// Unverified, since a quiet account can simply have had no activity early on, so it says probably
const HISTORY_LIMIT_NOTE = 'The bank probably keeps no more history.'

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
    // Says nothing of why, since a short outage or a quiet account gets nothing back as well as a
    // bank's history limit does
    return {
      title: 'No history returned yet',
      body: `${providerName} hasn't returned any posted transactions from ${requested} yet. If you used this account since then, please check for missing transactions.`,
    }
  }
  return {
    title: 'Less history than your chosen start',
    body: `${providerName} returned transactions from ${unbrokenDate(reminder.earliest_returned)}, not ${requested}. ${HISTORY_LIMIT_NOTE}`,
  }
}

/**
 * What the reminder says about a day kept though it brought back as many transactions as the
 * provider sends at once, counted across the connection's accounts, so it never names a number
 */
export function describeCutOffDay(day: string, providerName: string): ReminderCopy {
  return {
    title: 'You may be missing some transactions',
    body: `${providerName} sent its maximum number of transactions for ${unbrokenDate(day)}, so that day may have more transactions. Please check that day's transactions.`,
  }
}
