import type { Dispatch, SetStateAction } from 'react'
import type { Currency } from '@/api/currency'
import { useRestoreOnceWhenReady } from '@/hooks/useRestoreOnceWhenReady'
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
 * Nothing reaches this yet: applied filters are held in component state that a page load clears, and
 * the currency table never leaves the cache once it arrives, so a bound can only be applied while its
 * decimal places are already known. Filters that survive a page load are what make it live
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
  // Re-armed by each seeding rather than on an open prop, since the desktop pill seeds from its own
  // open handler and the mobile sheet from the rising edge of its open prop, and only the draft
  // itself is called by both
  return useRestoreOnceWhenReady({
    shouldRestore: isAppliedRangeWaitingOnCurrency(filters, currencies),
    readyValue: findAmountRangeDraft(filters, currencies),
    restore: setAmount,
  })
}
