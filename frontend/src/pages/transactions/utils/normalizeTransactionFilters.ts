import { TRANSACTION_FILTER_KEYS } from '@/pages/transactions/constants/transactionList'
import type { TransactionListFilters } from '@/pages/transactions/types/transactionList'

/**
 * Removes empty transaction filter fields before they become React Query parameters
 */
export function normalizeTransactionFilters(
  filters: TransactionListFilters,
): TransactionListFilters {
  const next = { ...filters }

  // Empty values, including empty arrays, are equivalent to absent filters for the backend contract
  for (const key of TRANSACTION_FILTER_KEYS) {
    const value = next[key]
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
      delete next[key]
    }
  }
  return next
}
