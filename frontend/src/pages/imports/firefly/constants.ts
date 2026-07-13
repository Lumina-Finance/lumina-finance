import type { AccountType } from '@/api/accounts'

/**
 * Columns the transactions export must contain before the flow can compile rows
 */
export const FIREFLY_TRANSACTIONS_REQUIRED_HEADERS = [
  'journal_id',
  'type',
  'amount',
  'currency_code',
  'date',
  'source_name',
  'source_type',
  'destination_name',
  'destination_type',
]

/**
 * Columns the optional budgets export must contain to derive budget drafts
 */
export const FIREFLY_BUDGETS_REQUIRED_HEADERS = ['name', 'start_date', 'currency_code', 'amount']

/**
 * Lumina account types keyed by lower-cased Firefly III liability account type
 */
export const FIREFLY_LIABILITY_ACCOUNT_TYPES: Record<string, AccountType> = {
  loan: 'loan',
  debt: 'line_of_credit',
  mortgage: 'mortgage',
}

export const FIREFLY_FALLBACK_ACCOUNT_TYPE: AccountType = 'checking'

/**
 * Name given to the category created for rows without a Firefly III category
 */
export const FIREFLY_UNCATEGORIZED_CATEGORY_NAME = 'Uncategorized'

export const FIREFLY_SAMPLE_PREVIEW_LIMIT = 5
export const FIREFLY_SKIPPED_VISIBLE_LIMIT = 8
export const FIREFLY_CSV_PROCESSING_MIN_MS = 1500
export const FIREFLY_IMPORT_OVERLAY_MIN_MS = 2000
