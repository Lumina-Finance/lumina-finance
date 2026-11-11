import type { BankImportRange } from '@/api/bank-sync'
import { addDays, addMonths, formatDateLabel, formatYmd, parseYmd } from '@/utils/date'

// How many months back the shorter start choices reach, offered beside the provider's own limit
const START_CHOICE_MONTHS = [3, 6]

type StartChoice = {
  key: string
  label: string

  /** The day the import starts on, as "YYYY-MM-DD" */
  date: string

  /** Set when the account's own history, not the months chosen, decides the date */
  note?: string
}

// The key of the choice that starts the day after the account's latest transaction
export const AFTER_LATEST_START = 'after-latest'

/**
 * The start dates offered as choices, newest first, none of them preselected
 *
 * Each month choice begins on the first of its month, counted back from the provider's limit. That
 * limit is itself the first of the month the provider's history reaches. An import may reach into days
 * the ledger already covers, since everything it brings in waits for review. So the day after the
 * account's latest transaction is a choice of its own, offered while the range allows it, and not
 * the earliest start. Choices that land on the same day are shown once, the month choice kept
 *
 * @param range - Where the server allows the import to start, with the day after the latest transaction
 * @param accountName - The account the import goes into, named in the latest transaction choice's note
 */
export function listStartChoices(range: BankImportRange, accountName: string): StartChoice[] {
  const providerLimit = parseYmd(range.provider_limit_date)
  if (!providerLimit) return []

  const months = [
    ...START_CHOICE_MONTHS.filter((count) => count < range.provider_history_months),
    range.provider_history_months,
  ]
  const choices: StartChoice[] = []
  for (const count of months) {
    const date = formatYmd(addMonths(providerLimit, range.provider_history_months - count))
    if (choices.some((choice) => choice.date === date)) continue
    choices.push({ key: `${count}`, label: `${count} months`, date })
  }

  const floor = range.ledger_floor
  if (floor && floor >= range.earliest_allowed && floor <= range.latest_allowed) {
    if (!choices.some((choice) => choice.date === floor)) {
      choices.push({
        key: AFTER_LATEST_START,
        label: 'After the latest transaction',
        date: floor,
        note: `From the day after ${accountName}'s latest transaction`,
      })
    }
  }

  return choices.sort((first, second) => (first.date < second.date ? 1 : first.date > second.date ? -1 : 0))
}

/**
 * The last day neither the account's own transactions nor an import from the given start cover, or
 * null when the import picks up right after them or the account has none
 *
 * @param range - Where the server allows the import to start, with the day after the latest transaction
 * @param start - The chosen start, as "YYYY-MM-DD"
 */
export function findUncoveredUntil(range: BankImportRange, start: string): string | null {
  const parsed = parseYmd(start)
  if (!parsed || !range.ledger_floor || start <= range.ledger_floor) return null

  return formatYmd(addDays(parsed, -1))
}

/**
 * Why the range refuses a day as the import's start, null for a day it allows
 *
 * @param range - Where the server allows the import to start
 * @param iso - The day, as "YYYY-MM-DD"
 */
export function describeStartRefusal(range: BankImportRange, iso: string): string | null {
  if (iso < range.earliest_allowed) return `The earliest start is ${formatDateLabel(range.earliest_allowed)}`
  if (iso > range.latest_allowed) return `The latest start is ${formatDateLabel(range.latest_allowed)}`
  return null
}

/**
 * Why the range refuses a day as a date range's last day, null for a day it allows
 *
 * @param range - Where the server allows the import to reach
 * @param iso - The day, as "YYYY-MM-DD"
 */
export function describeEndRefusal(range: BankImportRange, iso: string): string | null {
  if (iso < range.earliest_allowed) return `The earliest start is ${formatDateLabel(range.earliest_allowed)}`
  if (iso > range.latest_allowed) return `The latest end is ${formatDateLabel(range.latest_allowed)}`
  return null
}
