import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { Currency } from '@/api/currency'
import {
  findAmountRangeDraft,
  isAppliedRangeWaitingOnCurrency,
  type AmountDraft,
} from '@/pages/transactions/utils/amountRange'
import type { TransactionListFilters } from '@/pages/transactions/types/transactionList'

/**
 * Fills the amount bounds in when their currency's decimal places arrive, for a filter panel that
 * seeded them blank because it opened before the currency table did
 *
 * Without this the fields unlock empty over an applied range, and the next Apply writes that blank
 * back over it. Only an applied bound that could not be shown arms the fill, and the fields refuse
 * input for as long as one is waiting, so nothing typed can be overwritten
 *
 * @param filters - The applied filters, whose bounds are what gets restored
 * @param currencies - The currency table, which is empty until it downloads
 * @param setAmount - Writes the bounds into the draft
 * @returns Records whether there is anything to restore, for the draft to call as it seeds
 */
export function useRestoreAmountRange(
  filters: TransactionListFilters,
  currencies: Currency[],
  setAmount: Dispatch<SetStateAction<AmountDraft>>,
): () => void {
  const waitingRef = useRef(isAppliedRangeWaitingOnCurrency(filters, currencies))

  useEffect(() => {
    if (!waitingRef.current) return

    const appliedAmount = findAmountRangeDraft(filters, currencies)
    if (appliedAmount === null) return

    waitingRef.current = false
    setAmount(appliedAmount)
  }, [filters, currencies, setAmount])

  // Re-armed by each seeding rather than on an open prop, since the desktop pill seeds from its own
  // open handler and the mobile sheet from the rising edge of its open prop, and only the draft
  // itself is called by both
  return useCallback(() => {
    waitingRef.current = isAppliedRangeWaitingOnCurrency(filters, currencies)
  }, [filters, currencies])
}
