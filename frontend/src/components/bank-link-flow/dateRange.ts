import { useState } from 'react'
import type { BankImportRange } from '@/api/bank-sync'
import {
  RANGE_CROSSED_MESSAGE,
  RANGE_END_REQUIRED_MESSAGE,
  START_DATE_REQUIRED_MESSAGE,
} from '@/components/bank-link-flow/constants'
import { describeEndRefusal, describeStartRefusal } from '@/components/bank-link-flow/startChoices'
import { isDateRangeCrossed } from '@/utils/date'

/**
 * A date range the user types for a bank import, From and To, both included, and what is wrong with
 * each end. A From after To is said on From, since that is the end most often typed last
 *
 * @param range - Where the server allows the import to reach, undefined while it loads
 */
export function useBankDateRange(range: BankImportRange | undefined) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const getFromDisabledReason = (iso: string) => (range ? describeStartRefusal(range, iso) : null)
  const getToDisabledReason = (iso: string) => (range ? describeEndRefusal(range, iso) : null)
  const crossed = isDateRangeCrossed({ from, to })

  return {
    from,
    to,
    setFrom,
    setTo,
    getFromDisabledReason,
    getToDisabledReason,
    isFromDisabled: (iso: string) => getFromDisabledReason(iso) !== null,
    isToDisabled: (iso: string) => getToDisabledReason(iso) !== null,

    /** What a press would find wrong with From: missing, outside the range, naming the bound it passed, or after To */
    fromProblem: !from
      ? START_DATE_REQUIRED_MESSAGE
      : (getFromDisabledReason(from) ?? (crossed ? RANGE_CROSSED_MESSAGE : undefined)),

    /** What a press would find wrong with To: missing, or outside the range, naming the bound it passed */
    toProblem: !to ? RANGE_END_REQUIRED_MESSAGE : (getToDisabledReason(to) ?? undefined),

    /** Whether From comes after To, said at once rather than on a press */
    crossed,

    /** Forgets both days, for a range that changed under them */
    reset: () => {
      setFrom('')
      setTo('')
    },
  }
}

export type BankDateRangeState = ReturnType<typeof useBankDateRange>
