import type { AccountType } from '@/api/accounts'
import type { FireflyImportStage } from './types'

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
 * Lumina account types keyed by lower-cased Firefly III liability endpoint type
 */
export const FIREFLY_LIABILITY_ACCOUNT_TYPES: Record<string, AccountType> = {
  loan: 'loan',
  debt: 'line_of_credit',
  mortgage: 'mortgage',
}

export const FIREFLY_FALLBACK_ACCOUNT_TYPE: AccountType = 'checking'

/**
 * Journal types as they appear in the Firefly III transactions export
 */
export const FIREFLY_TYPE_WITHDRAWAL = 'withdrawal'
export const FIREFLY_TYPE_DEPOSIT = 'deposit'
export const FIREFLY_TYPE_TRANSFER = 'transfer'
export const FIREFLY_TYPE_OPENING_BALANCE = 'opening balance'
export const FIREFLY_TYPE_RECONCILIATION = 'reconciliation'

/**
 * Seeded system category the no-category placeholder matches to, since
 * Firefly III lets a transaction carry no category and Lumina requires one
 */
export const FIREFLY_MISCELLANEOUS_CATEGORY_NAME = 'Miscellaneous'

/**
 * Seeded system category names the import assigns to transfer legs and
 * balance adjustment rows
 */
export const FIREFLY_TRANSFER_CATEGORY_NAME = 'Transfer'
export const FIREFLY_BALANCE_ADJUSTMENT_CATEGORY_NAME = 'Balance Adjustment'

/**
 * Reason prefix for rows the payload builder drops before upload, followed
 * by the names of the identity fields the row is missing
 */
export const FIREFLY_MISSING_REQUIRED_VALUES_REASON = 'Missing required values'

/**
 * Reason shown for rows that fail conversion in a way no specific skip rule
 * anticipated, mirroring the backend's generic fallback word for word
 */
export const FIREFLY_GENERIC_SKIP_REASON = 'Row could not be converted'

export const FIREFLY_SAMPLE_PREVIEW_LIMIT = 5
export const FIREFLY_SKIPPED_TABLE_VISIBLE_LIMIT = 20
export const FIREFLY_CSV_PROCESSING_MIN_MS = 1500
export const FIREFLY_IMPORT_OVERLAY_MIN_MS = 2000

/**
 * Stages of the commit in the order they run, as the overlay lists them
 */
export const FIREFLY_IMPORT_STAGES: { id: FireflyImportStage; label: string }[] = [
  { id: 'transactions', label: 'Importing transactions' },
  { id: 'budgets', label: 'Importing budgets' },
]

/**
 * How long one commit stage holds the overlay before the next one takes over
 *
 * Both stages can finish faster than the transition between them reads, so
 * without a floor the budget stage would flash past unseen
 */
export const FIREFLY_IMPORT_STAGE_MIN_MS = 800

/**
 * How long a finished commit stage stays on the overlay struck off before the
 * next stage takes its place
 *
 * The strike is what tells the user the stage landed, so this has to outlast
 * the line being drawn and leave a beat to read it afterwards
 */
export const FIREFLY_IMPORT_STAGE_CROSS_OFF_MS = 750
