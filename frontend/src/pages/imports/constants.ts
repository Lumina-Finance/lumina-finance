import type { CSSProperties } from 'react'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { DropdownOption } from '@/components/dropdown/Dropdown'
import type { ColumnMap, ColumnTarget, ImportCategoryKind } from './types'
import type { ImportDateFormat } from './utils/valueParsers'

export const EMPTY_COLUMN_MAP: ColumnMap = {
  account_id: '',
  dt: '',
  category_id: '',
  amount: '',
  currency: '',
  merchant_id: '',
  notes: '',
  tag_ids: '',
  counterparty_account_id: '',
}

export const COLUMN_TARGETS: Array<{
  id: ColumnTarget
  label: string
  hint: string
  required?: boolean
}> = [
  { id: 'account_id', label: 'Account', hint: 'Resolved from the source account when the file contains one.' },

  // Straight after the account it belongs beside, and before every target that scores on values
  // alone, since those would otherwise claim a column of account names first
  {
    id: 'counterparty_account_id',
    label: 'Counterparty account',
    hint: 'Says which account a transfer\'s money went to, or came from, without writing a transaction into that account. Only transfer rows can use it, and a blank cell records the transfer as going outside this app.',
  },
  { id: 'dt', label: 'Date', hint: 'Transaction date.', required: true },
  { id: 'category_id', label: 'Category', hint: 'Resolved from imported category text.', required: true },
  { id: 'amount', label: 'Amount', hint: 'The transaction amount, negative for money out and positive for money in.', required: true },
  { id: 'currency', label: 'Currency', hint: 'ISO currency code. Checked against the account each row is written to.' },
  { id: 'merchant_id', label: 'Merchant', hint: 'Resolved from imported merchant text.' },
  { id: 'notes', label: 'Notes', hint: 'Optional transaction notes.' },
  { id: 'tag_ids', label: 'Tags', hint: 'Resolved from imported tag text.' },
]

// The merchant an imported row is filed under when its file states no payee, and the one a transfer
// row gets, since a transfer has no payee of its own. Both ship with the app, and these have to stay
// in step with the backend's own names, the way the balance adjustment category name does
export const UNKNOWN_MERCHANT_NAME = 'Unknown'
export const SELF_MERCHANT_NAME = 'Myself'

// The two answers the merchant step offers beside the merchants themselves, kept distinct from any
// merchant id. Creating is what a value gets when nothing matches it, and skipping files that
// value's rows under the shared merchant a row stating no payee gets
export const CREATE_MERCHANT_VALUE = '__create_merchant__'
export const SKIP_MERCHANT_VALUE = '__skip_merchant__'

// What one row may carry, matching what the API accepts. Checked here so an offending row is named
// against its row number in the preview rather than failing part-way through the upload
export const MAX_IMPORT_NOTES_LENGTH = 10_000
export const MAX_IMPORT_TAGS_PER_ROW = 32

// Distinct account or category values one import may declare, matching what the API accepts across
// a whole run rather than per request, so splitting the batches differently cannot get past it
export const MAX_IMPORT_MAPPINGS = 1_000

/**
 * Says an import declares more distinct values for a column than one import may carry
 *
 * Counted across every staged file, since they are committed together as one import. The way out
 * depends on which case it is, so the wording covers both: stage fewer files, or split the one file
 * that carries them all
 */
export function getTooManyMappingsError(kind: 'account' | 'category', count: number) {
  return `This import has ${count.toLocaleString()} different ${kind} values, and one import carries up to ${MAX_IMPORT_MAPPINGS.toLocaleString()}. Split the data into smaller imports.`
}

/**
 * Says a value queued as a new category carries a name the user already has, recording the other
 * direction, which the commit refuses because one name records one direction
 */
export function getCategoryDirectionClashError(source: string, existingName: string, existingKind: Category['kind']) {
  const direction = KIND_LABELS[existingKind].toLowerCase()
  return `${existingName} already records ${direction}, so ${source} cannot be created. Match it to that category, or set its type to ${direction}.`
}

/**
 * Says a row's notes are longer than the importer stores
 */
export function getRowNotesTooLongReason(length: number) {
  return `The notes are ${length.toLocaleString()} characters, and the importer stores up to ${MAX_IMPORT_NOTES_LENGTH.toLocaleString()}.`
}

/**
 * Says a row names more tags than one transaction may carry
 */
export function getRowTooManyTagsReason(count: number) {
  return `This row has ${count} tags, and a transaction carries up to ${MAX_IMPORT_TAGS_PER_ROW}.`
}

// Shown in the column mapping step where any row states no payee, which is every row when no column
// is mapped as the Merchant and only the blank ones where a column is. It asks for nothing: every
// transaction carries a merchant, so those rows are filed under one that ships with the app, and
// this says so before the import runs rather than leaving it to be noticed in the preview
export const ROWS_WITH_NO_PAYEE_TITLE = 'Rows with no payee'

/**
 * Says what will happen to the rows stating no payee, with them counted
 *
 * No merchant is stated, because which one a row gets depends on its category: a transfer has no
 * payee of its own and takes the merchant the app puts on its own transfers, while everything else
 * takes the one meaning the payee is not known.
 *
 * Mapping a column is offered only where none is mapped, since that is the better answer when the
 * file does hold the payee under a heading the guesser did not recognise. Where one is mapped there
 * is nothing to map, and the rows are the ones whose cell was left blank
 */
export function getRowsWithNoPayeeExplanation(rowCount: number, isMerchantColumnMapped: boolean) {
  const isOne = rowCount === 1
  const subject = isMerchantColumnMapped
    ? `${isOne ? '1 row leaves' : `${rowCount.toLocaleString()} rows leave`} the payee column blank`
    : `${isOne ? '1 row states' : `${rowCount.toLocaleString()} rows state`} no payee`
  const filed = `every transaction carries a merchant, so ${isOne ? 'it will be' : 'they will be'} filed under a merchant that ships with the app`

  return isMerchantColumnMapped
    ? `${subject}, and ${filed}.`
    : `${subject}, and ${filed}. Map the column holding the payee above if the file has one.`
}

// Shown over the upload control while the currency list is not in hand. Reading a file uses it to
// tell a cell holding a currency from a header word shaped like one, and that decision is kept on
// the staged file, so a file read without the list stays wrongly read once it arrives
export const CURRENCIES_LOADING_UPLOAD_BLOCK = 'Loading currencies...'
export const CURRENCIES_FAILED_UPLOAD_BLOCK = 'Currencies could not be loaded, and a file cannot be read without them. Reload the page to try again.'

// How many entries the skipped table lists before summarizing the remainder, shared by every table
// built on it: refused rows in both import flows, and the Firefly budgets it cannot bring in
export const SKIPPED_TABLE_VISIBLE_LIMIT = 20

// Why one row cannot be converted, listed against that row in the preview step. Each says what is
// wrong with the row itself, since the entry carries the row number and the row's own cells. A
// blank cell is told apart from an unreadable one, because filling it in and correcting the whole
// column's format are different jobs
export const ROW_ACCOUNT_BLANK_REASON = 'The account source is blank.'
export const ROW_CATEGORY_BLANK_REASON = 'The category source is blank.'
export const ROW_DATE_BLANK_REASON = 'The date cell is blank.'
export const ROW_DATE_UNREADABLE_REASON = 'The date does not match the chosen format.'
export const ROW_AMOUNT_BLANK_REASON = 'The amount cell is blank.'
export const ROW_AMOUNT_UNREADABLE_REASON = 'The amount is not a number.'
export const ROW_AMOUNT_TOO_LARGE_REASON = 'The amount is larger than this app can store.'

/**
 * Says an amount carries decimal places its currency does not have
 *
 * How many are allowed is the currency's answer rather than the importer's, so the message states
 * it. It also says how a period is read, because an amount like 1.234 written with a period
 * grouping the thousands fails here, and without that sentence the reason reads as a complaint
 * about a number the user considers whole
 */
export function getRowAmountTooPreciseReason(currency: string) {
  return `The amount has more decimal places than ${currency} has. A period is read as a decimal point, never as a separator between thousands.`
}
export const ROW_COUNTERPARTY_NOT_A_TRANSFER_REASON = 'A non-transfer transaction should not have a counterparty account recorded.'
export const ROW_COUNTERPARTY_IS_OWN_ACCOUNT_REASON = 'A transfer cannot record its own account as its counterparty.'

/**
 * Says a row states a currency its account is not kept in
 *
 * Both codes are given because the fix is a choice between them: either the row belongs in a
 * different account, or the column mapped as the currency is not what it looked like
 */
export function getRowCurrencyMismatchReason(rowCurrency: string, accountCurrency: string) {
  return `This row is in ${rowCurrency} but the account it would be written to is kept in ${accountCurrency}. Amounts are stored in the account's currency and are not converted, so write these rows to a ${rowCurrency} account, or set the Currency column to Do not import to bring them in as ${accountCurrency}.`
}
// Said against a row whose amount runs the opposite way to the kind of the category it is filed
// under. It imports, because a refund inside an expense category is real, but the app counts such a
// row two ways: cash flow reads the sign while the category total reads the kind
export const ROW_SIGN_DISAGREES_WITH_CATEGORY_REASON = 'The amount runs the opposite way to the kind of category this row is filed under.'

// Shown once for the whole file where every amount reads as money coming in, which almost always
// means the file states direction somewhere this reading is not looking
export const NO_OUTFLOWS_WARNING = 'Every row in this file reads as money coming in. If this file writes money out without a minus sign, or states the direction in a separate column, the amounts have to be corrected in the file before importing.'

/**
 * Shown above the column mapping table, saying how the importer reads an amount
 *
 * The rule is stated because the file is read one way and one way only, so a statement written to a
 * different convention has to be corrected before it is uploaded rather than mapped around
 */
export const AMOUNT_CONVENTION_NOTE = 'Imported amounts carry their own direction: money out is negative and money in is positive. An expense category normally holds negative amounts and an income category positive ones. The other way round is accepted for a refund or a loss, and those rows are listed for you to check before the import runs.'

// Shown where a source rows are written to matches an account the user has archived, which is the
// one account that source is not offered. The matched account names follow it
export const ARCHIVED_ACCOUNT_MATCH_EXPLANATION = 'An archived account takes no new transactions, so it is not offered as a choice here. Unarchive one of these to import rows into it, which means leaving this import and uploading your file again:'

// Shown once any source on either table is answered create, since nothing else in the flow says
// what an account made this way is and is not given
export const CREATED_ACCOUNT_TITLE = 'New Accounts'
export const CREATED_ACCOUNT_EXPLANATION = 'Accounts imported as new accounts (by selecting "Create New Account" in the "Existing Account" column) won\'t create starting balance nor credit limits automatically:'
// A balance adjustment rather than a field, because an account that already exists has no starting
// balance to set. Left to the user to want one rather than told to enter one, since a Firefly
// export carries its own opening balances and the import writes those as balance adjustments
// already
export const CREATED_ACCOUNT_BALANCE_NOTE = 'If you\'d like to enter a starting balance of an imported account, please create a balance adjustment transaction in that account'
// The edit button this describes is the pencil on the account's own card, which is the only place a
// credit limit can be set once the account exists
export const CREATED_ACCOUNT_CREDIT_LIMIT_NOTE = 'If you\'d like to set a credit limit for that account, you can do so by opening it from Accounts and using the edit button on its card'

// Shown in place of a mapping step whose list could not be fetched at all, since answering one
// against nothing maps every value to a new record and duplicates what the user already has
export const ACCOUNTS_LOAD_FAILURE_TITLE = 'Your accounts could not be loaded'
export const ACCOUNTS_LOAD_FAILURE_EXPLANATION = 'Without them every source here would have to become a new account, which would duplicate accounts you already have.'
export const CATEGORIES_LOAD_FAILURE_TITLE = 'Your categories could not be loaded'
export const CATEGORIES_LOAD_FAILURE_EXPLANATION = 'Without them every category in this file would have to become a new one, which would duplicate categories you already have.'

// Shown when the page could not ask which of the file's payee values already have a merchant.
// Every value would then read as one about to be created, which is what the step exists to stop
export const MERCHANT_MATCHES_LOAD_FAILURE_TITLE = 'Your merchants could not be checked'
export const MERCHANT_MATCHES_LOAD_FAILURE_EXPLANATION = 'Without that check every payee in this file reads as a new merchant, and importing would create merchants you already have.'

// Shown when a mapping was answered with an account that has since been deleted. The answer is
// dropped rather than sent, and nothing fills the row back in, so the user is told why a source
// they already dealt with is asking again
export const CLEARED_ACCOUNT_SOURCES_TITLE = 'Answers cleared'
// The answers a row can be given differ between the two tables, and one notice covers both, so it
// asks for an answer rather than listing which ones are on offer
export const CLEARED_ACCOUNT_SOURCES_EXPLANATION = 'An account these sources were matched to no longer exists, so their answers were cleared. Answer each one again:'
export const CLEARED_CATEGORY_SOURCES_TITLE = 'Answers cleared'
export const CLEARED_CATEGORY_SOURCES_EXPLANATION = 'A category these values were matched to no longer exists, so their answers were cleared. Choose a category for each one, or queue a new one for it:'

// Carries the account an import was started from, as a query parameter rather than router state so
// the scope survives a reload and a shared address
export const IMPORT_ACCOUNT_PARAM = 'account'

// Shown in place of the whole import page when the address points at an account no import can be
// written to, which the button on the account's own card never offers and only a typed or shared
// address reaches
export const IMPORT_NOT_PERMITTED_TITLE = 'This action is not permitted'
export const IMPORT_NOT_PERMITTED_EXPLANATION = 'Transactions can only be imported into an account that is open and not archived. This account is archived, closed, or no longer exists.'

// Shown over the accounts that appear only as a counterparty, which the import writes nothing to
export const COUNTERPARTY_ONLY_TABLE_TITLE = 'Counterparty accounts'
export const COUNTERPARTY_ONLY_EXPLANATION = 'These accounts only ever appeared as the counterparty of a transfer. Matching one to an account of your own records where the money came from or went to and writes no transaction into that account, which is why an account you have archived can be chosen here and stays archived. Leaving one unmatched records the transfer as going outside this app. To bring a name in as an account of your own instead, select Create New Account in its Existing Account column.'

// Each format is named by an example of its shape rather than by a standard, because the year-first
// option deliberately takes a slash and an unpadded part, which ISO 8601 does not. Keyed by format
// rather than listed, so every format is guaranteed a label and the picker takes its order from
// IMPORT_DATE_FORMATS instead of repeating it here
export const IMPORT_DATE_FORMAT_LABELS: Record<ImportDateFormat, { label: string; example: string }> = {
  yearFirst: { label: 'Year first', example: '2026-04-30' },
  dayFirst: { label: 'Day first', example: '30/04/2026' },
  monthFirst: { label: 'Month first', example: '04/30/2026' },
  written: { label: 'Written', example: 'April 30, 2026' },
}

export const KIND_LABELS: Record<Category['kind'], string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
}

// Kind decides which group a category falls under in the import dropdowns, and an explicit rank
// fixes that group order rather than leaving it to the browser's language rules, which can differ
// between a user's devices. The ranks run alphabetically, matching what the dropdown showed before,
// so a kind added later has to be placed here for the order to stay alphabetical
export const KIND_RANKS: Record<Category['kind'], number> = {
  expense: 0,
  income: 1,
  transfer: 2,
}

export const DEFAULT_CATEGORY_ICON = '🏷️'
export const CREATE_ACCOUNT_VALUE = '__create_account__'
export const CREATE_CATEGORY_VALUE = '__create_category__'

// What the batch bar's institution control holds before anything is chosen. The institution list
// already spends the empty string on "None", which is a real answer meaning the account belongs to
// no institution, so nothing chosen needs a value of its own. Absent from the options list, which
// is what leaves the control showing its placeholder rather than the first option's label
export const UNSET_BATCH_INSTITUTION = '__unset_institution__'
export const IMPORT_CATEGORY_KIND_OPTIONS: Array<{ value: ImportCategoryKind; label: string }> = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
]

export const ACCOUNT_KIND_LABELS: Record<AccountsOverview['account_kind'], string> = {
  asset: 'Assets',
  revolving: 'Revolving Credit',
  amortizing: 'Amortizing Debt',
}

// Kind decides which group an account falls under, and the dropdown heads a group every time the
// group changes going down the list, so accounts have to arrive gathered by kind or a kind reached
// twice is headed twice. The order is the one the account type list already uses
export const ACCOUNT_KIND_RANKS: Record<AccountsOverview['account_kind'], number> = {
  asset: 0,
  revolving: 1,
  amortizing: 2,
}

export const ACCOUNT_TYPE_OPTIONS: DropdownOption[] = [
  { value: 'checking', label: 'Checking', group: 'Assets' },
  { value: 'savings', label: 'Savings', group: 'Assets' },
  { value: 'term_deposit', label: 'Term Deposit', group: 'Assets' },
  { value: 'cash', label: 'Cash', group: 'Assets' },
  { value: 'investment', label: 'Investment', group: 'Assets' },
  { value: 'credit_card', label: 'Credit Card', group: 'Revolving Credit' },
  { value: 'line_of_credit', label: 'Line of Credit', group: 'Revolving Credit' },
  { value: 'heloc', label: 'HELOC', group: 'Revolving Credit' },
  { value: 'loan', label: 'Loan', group: 'Amortizing Debt' },
  { value: 'mortgage', label: 'Mortgage', group: 'Amortizing Debt' },
]

export const IMPORT_INSET_STYLE: CSSProperties = {
  background: 'color-mix(in srgb, var(--app-input-bg) 58%, var(--app-bg))',
}
