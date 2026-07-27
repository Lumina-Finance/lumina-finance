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
}

export const COLUMN_TARGETS: Array<{
  id: ColumnTarget
  label: string
  hint: string
  required?: boolean
}> = [
  { id: 'account_id', label: 'Account', hint: 'Resolved from the source account when the file contains one.' },
  { id: 'dt', label: 'Date', hint: 'Transaction date.', required: true },
  { id: 'category_id', label: 'Category', hint: 'Resolved from imported category text.', required: true },
  { id: 'amount', label: 'Amount', hint: 'Raw signed amount.', required: true },
  { id: 'currency', label: 'Currency', hint: 'ISO currency code.' },
  { id: 'merchant_id', label: 'Merchant', hint: 'Resolved from imported merchant text.' },
  { id: 'notes', label: 'Notes', hint: 'Optional transaction notes.' },
  { id: 'tag_ids', label: 'Tags', hint: 'Resolved from imported tag text.' },
]

// Each format is named by an example of its shape rather than by a standard, because the year-first
// option deliberately takes a slash and an unpadded part, which ISO 8601 does not
export const IMPORT_DATE_FORMAT_OPTIONS: Array<{ value: ImportDateFormat; label: string; example: string }> = [
  { value: 'yearFirst', label: 'Year first', example: '2026-04-30' },
  { value: 'dayFirst', label: 'Day first', example: '30/04/2026' },
  { value: 'monthFirst', label: 'Month first', example: '04/30/2026' },
  { value: 'written', label: 'Written', example: 'April 30, 2026' },
]

export const KIND_LABELS: Record<Category['kind'], string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
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
