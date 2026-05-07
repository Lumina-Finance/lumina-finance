import { TRANSACTION_FILTER_KEYS } from '@/transactions/constants/transactionList'
import type { TransactionListFilters } from '@/transactions/types/transactionList'

export function normalizeTransactionFilters(
  filters: TransactionListFilters,
): TransactionListFilters {
  const next = { ...filters }
  for (const key of TRANSACTION_FILTER_KEYS) {
    if (!next[key]) delete next[key]
  }
  return next
}
