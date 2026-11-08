import { useState } from 'react'
import type { BankImportRange } from '@/api/bank-sync'
import { describeStartRefusal, findUncoveredUntil, listStartChoices } from '@/components/bank-link-flow/startChoices'

// The start step's own date, kept apart from the preset choices' keys
export const CUSTOM_START = 'custom'

/**
 * The start the user chose for an import, among the presets the range allows or a custom date
 *
 * Nothing is chosen at first, so the import never reaches back further than the user meant it to
 *
 * @param range - Where the server allows the import to start, undefined while it loads
 * @param accountName - The account the import goes into, named in a raised choice's note
 */
export function useStartChoice(range: BankImportRange | undefined, accountName: string) {
  const [choice, setChoice] = useState<string | null>(null)
  const [customStart, setCustomStart] = useState('')

  const choices = range ? listStartChoices(range, accountName) : []
  const start = choice === CUSTOM_START ? customStart : (choices.find((preset) => preset.key === choice)?.date ?? '')
  const getDateDisabledReason = (iso: string) => (range ? describeStartRefusal(range, iso) : null)
  const isDateDisabled = (iso: string) => getDateDisabledReason(iso) !== null

  return {
    choice,
    choose: setChoice,
    customStart,
    setCustomStart,
    choices,

    /** The chosen day as "YYYY-MM-DD", empty until one is chosen */
    start,
    outOfRange: start !== '' && isDateDisabled(start),
    isDateDisabled,
    getDateDisabledReason,
    uncoveredUntil: range && start ? findUncoveredUntil(range, start) : null,

    /** Forgets the choice, for a range that changed under it */
    reset: () => {
      setChoice(null)
      setCustomStart('')
    },
  }
}

export type StartChoiceState = ReturnType<typeof useStartChoice>
