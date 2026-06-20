import type { TransactionListFilters } from '@/pages/transactions/types/transactionList'

export const DEFAULT_TRANSACTION_CATEGORY_ICON = '🏷️'

export const TRANSACTION_FILTER_KEYS: Array<keyof TransactionListFilters> = [
  'account_id',
  'category_id',
  'merchant_id',
  'tag_id',
  'tag_match',
  'currency',
  'min_amount',
  'max_amount',
  'amount_currency',
  'from_date',
  'to_date',
]

export const FILTER_LIST_LOADING_MIN_MS = 1000
export const TRANSACTION_LIST_EASE = [0.25, 0.1, 0.25, 1] as const
