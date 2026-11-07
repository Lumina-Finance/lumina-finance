import type { BankImportRange } from '@/api/bank-sync'
import { addDays, addMonths, formatYmd, parseYmd } from '@/utils/date'

// How many months back the shorter start choices reach, offered beside the provider's own limit
const START_CHOICE_MONTHS = [3, 6]

export interface StartChoice {
  key: string
  label: string

  /** The day the import starts on, as "YYYY-MM-DD" */
  date: string

  /** Set when the account's own history, not the months chosen, decides the date */
  note?: string
}

/**
 * The start dates offered as choices, newest first, none of them preselected
 *
 * Each begins on the first of its month, counted back from the provider's limit. That limit is itself the
 * first of the month the provider's history reaches. The range never allows a start before the day
 * after the account's latest transaction, so a choice reaching further back is raised to that day and
 * says so. Choices that land on the same day are shown once
 *
 * @param range - Where the server allows the import to start
 * @param accountName - The account the import goes into, named in a raised choice's note
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
    const reached = formatYmd(addMonths(providerLimit, range.provider_history_months - count))
    const raised = reached < range.earliest_allowed
    const date = raised ? range.earliest_allowed : reached
    if (choices.some((choice) => choice.date === date)) continue

    choices.push(
      raised
        ? {
            key: `${count}`,
            label: 'After the latest transaction',
            date,
            note: `Picks up the day after the latest transaction in ${accountName}`,
          }
        : { key: `${count}`, label: `${count} months`, date },
    )
  }

  return choices
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
