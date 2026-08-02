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
  other_account_id: '',
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
    id: 'other_account_id',
    label: 'Other account',
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

// One wording for the other-account column, shown against the column while it is being mapped and
// again over the accounts that only appear in it, so the two cannot drift apart
export const OTHER_ACCOUNT_EXPLANATION = 'Where a transfer\'s money went. Nothing is imported into an account that only appears as the other side, and recording it keeps moves inside one tax-advantaged category out of its limit totals.'
export const OTHER_ACCOUNT_ONLY_GROUP_TITLE = 'Only used as the other side of a transfer'

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
