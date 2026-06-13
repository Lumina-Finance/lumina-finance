import { TRANSACTION_FILTER_KEYS } from '@/pages/transactions/constants/transactionList'
import type { TransactionListFilters } from '@/pages/transactions/types/transactionList'

/**
 * Removes empty transaction filter fields before they become React Query parameters
 */
export function normalizeTransactionFilters(
  filters: TransactionListFilters,
): TransactionListFilters {
  const next = { ...filters }

  // Falsy values are equivalent to absent filters for the backend query contract
  for (const key of TRANSACTION_FILTER_KEYS) {
    if (!next[key]) delete next[key]
  }
  return next
}
