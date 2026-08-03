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
    hint: 'Says which account a transfer\'s money went to, or came from, without writing a transaction into that account. Only rows whose category records one can use it, and a blank cell records the transfer as going outside this app.',
  },
  { id: 'dt', label: 'Date', hint: 'Transaction date.', required: true },
  { id: 'category_id', label: 'Category', hint: 'Resolved from imported category text.', required: true },
  { id: 'amount', label: 'Amount', hint: 'Raw signed amount.', required: true },
  { id: 'currency', label: 'Currency', hint: 'ISO currency code.' },
  { id: 'merchant_id', label: 'Merchant', hint: 'Resolved from imported merchant text.' },
  { id: 'notes', label: 'Notes', hint: 'Optional transaction notes.' },
  { id: 'tag_ids', label: 'Tags', hint: 'Resolved from imported tag text.' },
]

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
export const ROW_COUNTERPARTY_NOT_A_TRANSFER_REASON = 'A non-transfer transaction should not have a counterparty account recorded.'
export const ROW_COUNTERPARTY_IS_OWN_ACCOUNT_REASON = 'A transfer cannot record its own account as its counterparty.'

// Shown where a source rows are written to matches an account the user has archived, which is the
// one account that source is not offered. The matched account names follow it
export const ARCHIVED_ACCOUNT_MATCH_EXPLANATION = 'An archived account takes no new transactions, so it is not offered as a choice here. Unarchive one of these to import rows into it:'

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
