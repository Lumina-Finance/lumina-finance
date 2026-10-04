import type { AccountType } from '@/api/accounts'
import type { ImportFileType } from '@/pages/imports/utils/fileIntake'
import type { ActualPaymentMode } from '@/pages/imports/actual/types'
import {
  IMPORT_ACCOUNT_NAME_MAX_LENGTH,
  IMPORT_BUDGET_NAME_MAX_LENGTH,
  IMPORT_CATEGORY_NAME_MAX_LENGTH,
  IMPORT_TAG_NAME_MAX_LENGTH,
  JOURNAL_ROW_FIELD_MAX_LENGTHS,
} from '@/pages/imports/constants'

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
 * Tables, views and columns the reader queries, and category_mapping, which Actual's transactions
 * view reads merges from, checked before any are read. Transactions, payees and categories are
 * read through Actual's own views, so merges and deletions resolve the way Actual's screens show them
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

/** Prefixes that keep each category role's mapping sources apart from Actual's category ids */
export const ACTUAL_TRANSFER_CATEGORY_SOURCE_PREFIX = 'transfer:'
export const ACTUAL_OFF_BUDGET_CATEGORY_SOURCE_PREFIX = 'off-budget:'

// The one source every transfer paying down a credit card, line of credit or HELOC is filed under
export const ACTUAL_CREDIT_PAYMENT_CATEGORY_SOURCE = 'credit-payment:'
export const ACTUAL_CREDIT_PAYMENT_LABEL = 'Payments to credit cards and credit lines'

// Payments a category carries to off-budget accounts stay transfers until the user files them in the
// category, since the account they reach comes in as one of the user's own, as a tracked debt does
export const ACTUAL_DEFAULT_PAYMENT_MODE: ActualPaymentMode = 'transfer'

export const ACTUAL_TRANSFER_SIDE_LEFT_OUT_REASON = "The other side of this transfer is left out, so this side is left out with it"

export function getActualUnbalancedSplitReason(partsTotal: string, total: string) {
  return `Its split parts add up to ${partsTotal}, not the ${total} the transaction is for, so Actual flags it as unbalanced`
}

export function getActualTagTooLongReason(tag: string) {
  return `The tag #${tag.slice(0, 28)} is longer than the ${IMPORT_TAG_NAME_MAX_LENGTH} characters a tag can have`
}

export function getActualPayeeTooLongReason(length: number) {
  return `The payee is ${length.toLocaleString()} characters, and the importer takes up to ${JOURNAL_ROW_FIELD_MAX_LENGTHS.payee}`
}

export const ACTUAL_INCOME_BUDGET_REASON = 'Budgets only track expenses, so income budgets aren\'t imported'

export function getActualBudgetAmountReason(amount: string, currencyCode: string) {
  return `One of its months is budgeted at ${amount}, which has more decimal places than ${currencyCode} allows`
}

export function getActualBudgetGroupCategoryReason(categoryName: string) {
  return `Its category, ${categoryName}, is matched to a group category, and imported budgets can only use your own or built-in categories`
}

// An imported budget tracks one expense category, as a budget made in the app does
export const ACTUAL_BUDGET_NOT_EXPENSE_REASON = "Budgets only track expenses, and its category is matched to or set up as another type. Match it to an expense category, or set its type to Expense"

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

// Marks a new category renamed because an existing one holds its name for another kind, as Actual
// Budget's users call it
export const ACTUAL_CATEGORY_RENAME_APP_NAME = 'Actual'

export function getActualCategoryNameTooLongError(label: string) {
  return `Match ${label} to an existing category, since a new category name holds at most ${IMPORT_CATEGORY_NAME_MAX_LENGTH} characters.`
}

export const ACTUAL_BUDGET_NAME_TOO_LONG_REASON = `Its name is over ${IMPORT_BUDGET_NAME_MAX_LENGTH} characters, longer than a budget name can be`

export function getActualAmountPrecisionReason(amount: string, currencyCode: string) {
  return `The amount ${amount} has more decimal places than ${currencyCode} holds`
}

export function getActualSharedAccountError(labels: string[], accountName: string) {
  return `${labels.join(' and ')} are linked to the same account, ${accountName}. Link each Actual account to an account of its own.`
}

export function getActualMixedCurrencyError(currencies: string[]) {
  return `An Actual budget has one currency, but its accounts are set to ${currencies.join(', ')}. Choose one currency for every account.`
}

export function getActualFileCurrencyError(fileCurrency: string, labels: string[]) {
  return `This budget is in ${fileCurrency}, so every account must be in ${fileCurrency} too. Change the currency of ${labels.join(', ')}.`
}

export function getActualTransferCategoryError(label: string) {
  return `Match ${label} to a transfer category, since its rows stay transfers between your accounts.`
}

// A payment filed as spending keeps its budget-side leg, which a transfer category takes only when it
// records the other account
export function getActualPaymentCategoryError(label: string, categoryName: string) {
  return `Match ${label} to another category, since ${categoryName} can't record the other account of its payments.`
}

// Explains a category's payments to off-budget accounts and what each choice does with them. An
// income category's payments come into the budget, so only an expense category's reach a budget
export function getActualPaymentsHelp(categoryName: string, isIncome: boolean) {
  const asCategory = isIncome
    ? `As Income, they count as income in ${categoryName}`
    : `As Expense, they count as spending in ${categoryName}, so its budget counts them the way Actual did`
  return `In Actual, these are payments between a budget account and an off-budget account, like a loan, that you gave the ${categoryName} category. As Transfer, they're imported as transfers between your accounts, which don't count as spending or income. ${asCategory}, and the off-budget account still records them, so its balance stays right.`
}

export function getActualAccountNameTooLongError(label: string) {
  return `Link to an existing account, since a new account name holds at most ${IMPORT_ACCOUNT_NAME_MAX_LENGTH} characters: ${label}`
}

// The page Actual keeps on exporting a budget, linked rather than repeated so the steps stay current
export const ACTUAL_EXPORT_DOCS_URL = 'https://actualbudget.org/docs/backup-restore/backup/'

// Actual exports a budget as a zip, and keeps it as db.sqlite in its data folder. The reader tells
// the two apart by their contents, so the name only screens out files that are neither
export const ACTUAL_IMPORT_FILE_TYPE: ImportFileType = {
  matches: (file) => /\.(zip|sqlite)$/i.test(file.name),
  processingStatus: 'Reading budget',
  multipleFilesReason: 'Choose one Actual Budget export at a time.',
  wrongTypeReason: ACTUAL_FILE_GUIDANCE,
  nonFileDropReason: 'Drop an Actual Budget export, not text or other page content.',
  directoryDropReason: `Folders cannot be uploaded. ${ACTUAL_FILE_GUIDANCE}`,
}

export function getActualUnsupportedCurrencyError(currencyCode: string) {
  return `This budget is in ${currencyCode}, which Lumina Finance does not support yet.`
}

// The seeded category Lumina files transfer legs and one-sided transfers under. Rows without a category
// go to the shared IMPORT_MISCELLANEOUS_CATEGORY_NAME
export const ACTUAL_TRANSFER_CATEGORY_NAME = 'Transfer'

// An account created from Actual opens with the starting balance Actual recorded for it, written as
// a balance adjustment, so the shared note about adding one does not apply
export const ACTUAL_CREATED_ACCOUNT_EXPLANATION = 'These will be created as new accounts, each opening with the starting balance Actual recorded and no credit limit:'
