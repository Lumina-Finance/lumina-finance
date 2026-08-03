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
    hint: 'Account a transfer moved money to or from. Used only on transfer rows.',
  },
  { id: 'dt', label: 'Date', hint: 'Transaction date.', required: true },
  { id: 'category_id', label: 'Category', hint: 'Resolved from imported category text.', required: true },
  { id: 'amount', label: 'Amount', hint: 'Raw signed amount.', required: true },
  { id: 'currency', label: 'Currency', hint: 'ISO currency code.' },
  { id: 'merchant_id', label: 'Merchant', hint: 'Resolved from imported merchant text.' },
  { id: 'notes', label: 'Notes', hint: 'Optional transaction notes.' },
  { id: 'tag_ids', label: 'Tags', hint: 'Resolved from imported tag text.' },
]

// Shown against the counterparty column while it is being mapped
export const COUNTERPARTY_EXPLANATION = 'Says which account a transfer\'s money went to, or came from. Only transfer rows can use it, and a blank cell records the transfer as going outside this app.'

// How many refused rows the skipped table lists before summarizing the remainder, which both
// import flows share
export const SKIPPED_TABLE_VISIBLE_LIMIT = 20

// Why one row cannot be converted, listed against that row in the preview step. Each says what is
// wrong with the row itself, since the entry carries the file, the line and the row's own cells
export const ROW_ACCOUNT_BLANK_REASON = 'The account source is blank.'
export const ROW_CATEGORY_BLANK_REASON = 'The category source is blank.'
export const ROW_DATE_UNREADABLE_REASON = 'The date does not match the chosen format.'
export const ROW_AMOUNT_UNREADABLE_REASON = 'The amount is not a number.'
export const ROW_COUNTERPARTY_NOT_A_TRANSFER_REASON = 'Only a transfer records a counterparty account, and this row\'s category is not one.'
export const ROW_COUNTERPARTY_IS_OWN_ACCOUNT_REASON = 'A transfer cannot record its own account as its counterparty.'

// Shown where a source rows are written to matches an account the user has archived, which is the
// one account the dropdown above does not offer. The matched account names follow it
export const ARCHIVED_ACCOUNT_MATCH_EXPLANATION = 'An archived account takes no new transactions, so it is not offered above. Unarchive one of these to import rows into it:'

// Shown over the accounts that appear only as a counterparty, which the import writes nothing to
export const COUNTERPARTY_ONLY_TABLE_TITLE = 'Counterparty accounts'
export const COUNTERPARTY_ONLY_EXPLANATION = 'These accounts only ever appeared as the counterparty of a transfer, so no imported row is written to them and the importer creates nothing for them. Choosing one records where the transfer\'s money came from or went to, which is why an archived account is offered here and stays archived. To keep a source as an account of your own, select Create New Account in its Existing Account column.'

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
