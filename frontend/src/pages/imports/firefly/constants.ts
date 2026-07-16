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
 *
 * The archived flag is required rather than assumed, because an export without
 * it cannot say which budgets were retired, and importing a retired budget as a
 * live one is worse than refusing the file. Both period dates are required
 * because each limit period becomes a budget period with those exact dates
 */
export const FIREFLY_BUDGETS_REQUIRED_HEADERS = [
  'name',
  'active',
  'start_date',
  'end_date',
  'currency_code',
  'amount',
]

/**
 * Value the budgets export carries for a budget that is not archived, with
 * anything else read as archived so a value we do not recognise leaves the
 * budget visibly skipped rather than quietly imported
 */
export const FIREFLY_BUDGET_ACTIVE_VALUE = '1'

/**
 * Why an archived budget is listed but never imported
 *
 * Lumina Finance has no archived budgets, so importing one would raise a budget
 * the user retired. The reason stops at what is true today rather than hinting
 * at support that is not committed to
 */
export const FIREFLY_BUDGET_ARCHIVED_REASON = 'Archived in Firefly III, which Lumina Finance does not support'

/**
 * Why a budget no transaction references is never imported, since its tracked
 * categories can only be inferred from the transactions that carry it
 */
export const FIREFLY_BUDGET_NO_TRANSACTIONS_REASON = 'No imported transactions reference this budget'

/**
 * Why a budget whose transactions all lost their categories is never imported
 */
export const FIREFLY_BUDGET_NO_CATEGORIES_REASON = 'No mapped categories reference this budget'

/**
 * Why a budget without a single usable limit period is never imported
 */
export const FIREFLY_BUDGET_NO_LIMITS_REASON = 'The export has no limit periods for this budget'

/**
 * Why a budget whose limit history spans currencies is never imported, since a
 * Lumina Finance budget holds exactly one currency
 */
export const FIREFLY_BUDGET_MIXED_CURRENCIES_REASON = 'Its limit periods mix more than one currency'

/**
 * Why a budget repeating on a period length no Lumina Finance cadence can
 * express is never imported
 *
 * Its history would arrive intact, but the budget could never continue on its
 * own rhythm here, which is the same distortion an archived budget would
 * suffer, so it is skipped rather than imported frozen
 */
export const FIREFLY_BUDGET_UNSUPPORTED_CADENCE_REASON = 'Repeats on a period length Lumina Finance budgets do not support'

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
