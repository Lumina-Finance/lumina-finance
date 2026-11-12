import { useState } from 'react'
import type { BankImportRange } from '@/api/bank-sync'
import { useBankDateRange } from '@/components/bank-link-flow/dateRange'
import { findUncoveredUntil, listStartChoices } from '@/components/bank-link-flow/startChoices'

// The start step's own dates, From and To, kept apart from the preset choices' keys
export const CUSTOM_START = 'custom'

/**
 * The days the user chose for an import: a preset through today, or custom dates with a From and a To.
 * To starts at today once custom dates are chosen, so a custom start alone keeps syncing on, and a To
 * moved before today makes it a range of its own
 *
 * Nothing is chosen at first, so the import never reaches back further than the user meant it to
 *
 * @param range - Where the server allows the import to start, undefined while it loads
 * @param accountName - The account the import goes into, named in the latest transaction choice's note
 */
export function useStartChoice(range: BankImportRange | undefined, accountName: string) {
  const [choice, setChoice] = useState<string | null>(null)
  const dateRange = useBankDateRange(range)

  const choices = range ? listStartChoices(range, accountName) : []
  const custom = choice === CUSTOM_START
  const start = custom ? dateRange.from : (choices.find((preset) => preset.key === choice)?.date ?? '')

  // Only a To before today ends the import early. Through today, syncing carries on from it
  const end = custom && range && dateRange.to !== '' && dateRange.to < range.latest_allowed ? dateRange.to : null

  return {
    choice,
    choose: (key: string) => {
      setChoice(key)
      if (key === CUSTOM_START && dateRange.to === '' && range) dateRange.setTo(range.latest_allowed)
    },
    choices,
    dateRange,

    /** The chosen first day as "YYYY-MM-DD", empty until one is chosen */
    start,

    /** The last day as "YYYY-MM-DD" when custom dates end before today, otherwise null for today */
    end,

    // A range ending before today leaves the days after it as they are, and its own note says so
    uncoveredUntil: range && start && end === null ? findUncoveredUntil(range, start) : null,

    /** Forgets the choice, for a range that changed under it */
    reset: () => {
      setChoice(null)
      dateRange.reset()
    },
  }
}

export type StartChoiceState = ReturnType<typeof useStartChoice>
