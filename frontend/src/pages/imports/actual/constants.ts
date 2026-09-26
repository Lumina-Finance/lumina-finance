import type { AccountType } from '@/api/accounts'
import type { ImportFileType } from '@/pages/imports/utils/fileIntake'

const MIB = 1024 * 1024

/** Largest export zip the import opens, checked before anything is unpacked */
export const MAX_ACTUAL_ZIP_BYTES = 100 * MIB

/**
 * Largest database the import opens, whether it arrives bare or unpacked from a zip. Actual keeps
 * its sync history in the same file, so a long-used budget is several times its data
 */
export const MAX_ACTUAL_DATABASE_BYTES = 250 * MIB

/** Most the import unpacks from one zip, whatever it declares, so a zip bomb stops at the listing */
export const MAX_ACTUAL_UNPACKED_BYTES = 250 * MIB

/** The file Actual keeps a budget in, at the top of its export zip or inside one folder */
export const ACTUAL_DATABASE_FILE_NAME = 'db.sqlite'
export const ACTUAL_METADATA_FILE_NAME = 'metadata.json'

/**
 * Actual 26.9 keeps every transaction in hundredths whatever the budget's currency, even though
 * its currency feature treats some currencies as having no decimal places
 */
export const ACTUAL_TRANSACTION_DECIMALS = 2

/**
 * Currencies Actual 26.9's own currency table gives no decimal places. Once its currency feature
 * is on, its budget screen stores figures in these currencies as whole units, not hundredths
 */
export const ACTUAL_ZERO_DECIMAL_CURRENCIES = new Set(['IRR', 'JPY', 'KRW'])

/**
 * Newest database migration in the Actual release the import was checked against. A file in a
 * zero-decimal currency from a later release is refused, since a release that starts storing
 * those transactions in whole units would otherwise import every amount 100 times too large, and
 * nothing in the file says which way a row was written
 */
export const ACTUAL_NEWEST_CHECKED_MIGRATION = 1787013118115

/**
 * Tables, views and columns the reader queries, checked before any are read. Transactions,
 * payees and categories are read through Actual's own views, so merges and deletions resolve the
 * way Actual's screens show them
 */
export const ACTUAL_REQUIRED_COLUMNS: Record<string, string[]> = {
  accounts: ['id', 'name', 'offbudget', 'closed', 'tombstone', 'type', 'sort_order'],
  category_groups: ['id', 'name', 'hidden'],
  category_mapping: ['id', 'transferId'],
  v_payees: ['id', 'name', 'transfer_acct', 'tombstone'],
  v_categories: ['id', 'name', 'is_income', 'hidden', 'group', 'tombstone'],
  v_transactions: [
    'id',
    'is_parent',
    'parent_id',
    'account',
    'category',
    'amount',
    'payee',
    'notes',
    'date',
    'starting_balance_flag',
    'transfer_id',
    'sort_order',
  ],
  zero_budgets: ['month', 'category', 'amount', 'carryover'],
  reflect_budgets: ['month', 'category', 'amount', 'carryover'],
  preferences: ['id', 'value'],
}

/** Where to get a file the import reads, repeated in each refusal that means the wrong file came */
export const ACTUAL_FILE_GUIDANCE = "Choose the .zip from Actual's Settings under Export data, or the db.sqlite in Actual's data folder."

/**
 * Longest tag and payee the import endpoint takes, mirroring the backend schema. Actual takes
 * longer ones, and one such row would fail the whole import, so it is left out with the value named
 */
export const ACTUAL_TAG_NAME_MAX_LENGTH = 64
export const ACTUAL_PAYEE_NAME_MAX_LENGTH = 256

/** Prefixes that keep each category role's mapping sources apart from Actual's category ids */
export const ACTUAL_TRANSFER_CATEGORY_SOURCE_PREFIX = 'transfer:'
export const ACTUAL_OFF_BUDGET_CATEGORY_SOURCE_PREFIX = 'off-budget:'

export const ACTUAL_FUTURE_ROW_REASON = "Dated after today, so it hasn't happened yet"

export function getActualUnbalancedSplitReason(partsTotal: string, total: string) {
  return `Its split parts add up to ${partsTotal}, not the ${total} the transaction is for, so Actual flags it as unbalanced`
}

export function getActualTagTooLongReason(tag: string) {
  return `The tag #${tag.slice(0, 28)} is longer than the ${ACTUAL_TAG_NAME_MAX_LENGTH} characters a tag can have`
}

export function getActualPayeeTooLongReason(length: number) {
  return `The payee is ${length.toLocaleString()} characters, and the importer takes up to ${ACTUAL_PAYEE_NAME_MAX_LENGTH}`
}

export const ACTUAL_INCOME_BUDGET_REASON = 'Lumina Finance budgets track spending, so a budget for income is not imported'

export function getActualBudgetAmountReason(amount: string, currencyCode: string) {
  return `Its budgeted amount ${amount} has more decimal places than ${currencyCode} holds`
}

export function getActualBudgetGroupCategoryReason(categoryName: string) {
  return `Its category ${categoryName} is matched to a group category, and an imported budget can only track your own or built-in categories`
}

/**
 * Lumina account types for the types older Actual releases asked for when an account was made.
 * Newer releases leave the type empty, and the balance decides instead
 */
export const ACTUAL_ACCOUNT_TYPES: Record<string, AccountType> = {
  checking: 'checking',
  savings: 'savings',
  credit: 'credit_card',
  investment: 'investment',
  mortgage: 'mortgage',
  debt: 'loan',
}

// The longest name a Lumina account takes, which an Actual account name can exceed
export const ACTUAL_ACCOUNT_NAME_MAX_LENGTH = 256

export function getActualAmountPrecisionReason(amount: string, currencyCode: string) {
  return `The amount ${amount} has more decimal places than ${currencyCode} holds`
}

export function getActualSharedAccountError(labels: string[], accountName: string) {
  return `${labels.join(' and ')} are linked to the same account, ${accountName}. Link each Actual account to an account of its own.`
}

export function getActualMixedCurrencyError(currencies: string[]) {
  return `An Actual budget has one currency, but its accounts are set to ${currencies.join(', ')}. Choose one currency for every account.`
}

export function getActualTransferCategoryError(label: string) {
  return `Match ${label} to a transfer category, since its rows stay transfers between your accounts.`
}

export function getActualAccountNameTooLongError(label: string) {
  return `Link to an existing account, since a new account name holds at most ${ACTUAL_ACCOUNT_NAME_MAX_LENGTH} characters: ${label}`
}

export function getActualCategoryCreateClashError(firstLabel: string, secondLabel: string) {
  return `${firstLabel} and ${secondLabel} would be created as one category, so they need the same type.`
}

// How many transactions the preview shows before the import
export const ACTUAL_SAMPLE_PREVIEW_LIMIT = 5

// The budget import takes a bounded number of budgets at once
export const ACTUAL_MAX_BUDGETS = 1000

// The page Actual keeps on exporting a budget, linked rather than repeated so the steps stay current
export const ACTUAL_EXPORT_DOCS_URL = 'https://actualbudget.org/docs/backup-restore/backup/'

// Actual exports a budget as a zip, and keeps it as db.sqlite in its data folder. The reader tells
// the two apart by their contents, so the name only screens out files that are neither
export const ACTUAL_IMPORT_FILE_TYPE: ImportFileType = {
  matches: (file) => /\.(zip|sqlite)$/i.test(file.name),
  multipleFilesReason: 'Choose one Actual Budget export at a time.',
  wrongTypeReason: ACTUAL_FILE_GUIDANCE,
  nonFileDropReason: 'Drop an Actual Budget export, not text or other page content.',
  directoryDropReason: `Folders cannot be uploaded. ${ACTUAL_FILE_GUIDANCE}`,
}

export function getActualUnsupportedCurrencyError(currencyCode: string) {
  return `This budget is in ${currencyCode}, which Lumina Finance does not support yet.`
}

// The seeded categories Lumina files transfer legs, one-sided transfers and rows without a category under
export const ACTUAL_TRANSFER_CATEGORY_NAME = 'Transfer'
export const ACTUAL_MISCELLANEOUS_CATEGORY_NAME = 'Miscellaneous'

// An account created from Actual opens with the starting balance Actual recorded for it, written as
// a balance adjustment, so the shared note about adding one does not apply
export const ACTUAL_CREATED_ACCOUNT_EXPLANATION = 'These will be created as new accounts, each opening with the starting balance Actual recorded and no credit limit:'
