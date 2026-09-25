import type { AccountType } from '@/api/accounts'
import { STEP_DOT_WAVE_MS } from '@/pages/imports/components'
import { LOADING_ANIMATION_MIN_MS } from '@/utils/timing'
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
 * anything else read as archived so a value we do not recognise imports the
 * budget archived rather than active, the safer of the two directions
 */
export const FIREFLY_BUDGET_ACTIVE_VALUE = '1'

/**
 * Longest tag name a Lumina tag can hold, mirroring the backend cap
 *
 * Firefly III allows longer tags, and a row carrying one would fail the
 * whole upload batch on the backend, so such rows are dropped before upload
 * with the tag named instead
 */
export const FIREFLY_TAG_NAME_MAX_LENGTH = 64

// The longest name a Lumina account takes, which Firefly III account names can exceed
export const FIREFLY_ACCOUNT_NAME_MAX_LENGTH = 256

/**
 * Longest value the import endpoint takes in each row field, mirroring the backend schema
 *
 * An export can still hold a longer value, from Firefly III's longer text fields or a hand-edited
 * file, and one such row would fail its whole upload batch, so it is dropped before upload with
 * the field named instead
 */
export const FIREFLY_ROW_FIELD_MAX_LENGTHS = {
  journalId: 64,
  type: 64,
  amount: 64,
  description: 1024,
  category: 256,
  payee: 256,
} as const

export const FIREFLY_TAG_TOO_LONG_REASON = 'Tag name is too long'

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
 * Why a budget whose export rows carry dates that name no real day is never
 * imported, since a corrupted file should be refused before upload rather
 * than failing the whole budget batch on the backend
 */
export const FIREFLY_BUDGET_UNREADABLE_DATES_REASON = 'A limit period date in the export is not a real calendar date'

/**
 * Why a budget whose limit history spans currencies is never imported, since a
 * Lumina Finance budget holds exactly one currency
 */
export const FIREFLY_BUDGET_MIXED_CURRENCIES_REASON = 'Its limit periods mix more than one currency'

/**
 * Why a budget with a limit period ending before it starts is never imported
 */
export const FIREFLY_BUDGET_PERIOD_ENDS_BEFORE_START_REASON = 'A limit period ends before it starts'

/**
 * Why a budget whose limit periods share days is never imported, since a Lumina Finance budget
 * holds one limit for each day
 *
 * Firefly III refuses only a second limit over the identical range and currency, so a monthly
 * limit and a custom-range limit over the same days can both be exported
 */
export const FIREFLY_BUDGET_OVERLAPPING_PERIODS_REASON = 'Two of its limit periods overlap'

/**
 * Longest budget name, most limit periods and most tracked categories the budget import takes,
 * mirroring the backend schema
 */
export const FIREFLY_BUDGET_NAME_MAX_LENGTH = 256
export const FIREFLY_BUDGET_MAX_LIMIT_PERIODS = 1200
export const FIREFLY_BUDGET_MAX_CATEGORIES = 1000

/**
 * Most budgets one import takes, mirroring the backend schema
 */
export const FIREFLY_MAX_BUDGETS = 1000

/**
 * Longest cadence the budget import stores, the largest value its small-integer column holds
 */
export const FIREFLY_BUDGET_MAX_INSTANCE_LENGTH = 32767

/**
 * Why a budget in a currency Lumina Finance does not have is never imported, such as a custom
 * currency Firefly III lets its users add
 */
export function getFireflyBudgetUnsupportedCurrencyReason(currencyCode: string) {
  return `Its currency, ${currencyCode}, is not one Lumina Finance supports`
}

/**
 * Why a budget with a limit amount its currency cannot hold is never imported
 */
export function getFireflyBudgetAmountReason(amount: string, currencyCode: string, problem: string) {
  return `Its limit amount ${amount} ${currencyCode} ${problem}`
}

/**
 * Why a budget matched to a group's category is never imported, since an imported budget is the
 * user's own and can track only their own categories and the built-in ones
 */
export function getFireflyBudgetGroupCategoryReason(categoryName: string) {
  return `Its category ${categoryName} is matched to a group category, and an imported budget can only track your own or built-in categories`
}

/**
 * Why a budget past one of the budget import's limits is never imported
 */
export function getFireflyBudgetOverLimitReason(what: string, count: number, maxCount: number) {
  return `Its ${what} is ${count.toLocaleString()}, and the importer takes up to ${maxCount.toLocaleString()}`
}

/**
 * Why a budget repeating on a period length no Lumina Finance cadence can
 * express is never imported
 *
 * A live budget repeating on a shape no Lumina Finance cadence expresses
 * could never continue on its own rhythm here, so it is skipped rather than
 * imported on a wrong cadence
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
 * Seeded system category the import assigns to transfer legs
 */
export const FIREFLY_TRANSFER_CATEGORY_NAME = 'Transfer'

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

/**
 * Reasons the backend gives for a row whose endpoints leave it nothing to write, word for word.
 * The browser drops such a row before upload, since whether it imports never depends on a mapping
 */
export const FIREFLY_BALANCE_ROW_UNATTACHED_REASON = 'Opening balance or reconciliation row is not attached to an imported account'
export const FIREFLY_WITHDRAWAL_SOURCE_UNTRACKED_REASON = 'Withdrawal source is not an imported account'
export const FIREFLY_DEPOSIT_DESTINATION_UNTRACKED_REASON = 'Deposit destination is not an imported account'
export const FIREFLY_TRANSFER_ENDPOINT_UNTRACKED_REASON = 'Transfer endpoint is not an imported account'

export function getFireflyUnsupportedTypeReason(type: string) {
  return `Journal type "${type}" is not supported, the importer handles`
    + ' withdrawals, deposits, transfers, opening balances, and reconciliations'
}

/**
 * Line a split's sent notes start with, naming the Firefly III transaction the split belongs to
 */
export function getFireflySplitTitleLine(groupTitle: string) {
  return `Split transaction: ${groupTitle}`
}

export const FIREFLY_SAMPLE_PREVIEW_LIMIT = 5
export const FIREFLY_CSV_PROCESSING_MIN_MS = LOADING_ANIMATION_MIN_MS
export const FIREFLY_IMPORT_OVERLAY_MIN_MS = LOADING_ANIMATION_MIN_MS

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
 * without a floor the budget stage would flash past unseen. The floor is
 * pinned to one full dot wave so a stage is never struck off mid-cycle
 */
export const FIREFLY_IMPORT_STAGE_MIN_MS = STEP_DOT_WAVE_MS

/**
 * How long a finished commit stage stays on the overlay struck off before the
 * next stage takes its place
 *
 * The strike is what tells the user the stage landed, so this has to outlast
 * the line being drawn and leave a beat to read it afterwards
 */
export const FIREFLY_IMPORT_STAGE_CROSS_OFF_MS = 750
