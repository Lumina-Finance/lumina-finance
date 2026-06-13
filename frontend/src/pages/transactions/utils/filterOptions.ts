import type { Category } from '@/api/categories'
import type { OptionItem } from '@/components/filters/FilterOptionList'
import { DEFAULT_TRANSACTION_CATEGORY_ICON } from '@/pages/transactions/constants/transactionList'
import type { TransactionListAccount, TransactionListFilters } from '@/pages/transactions/types/transactionList'

const CATEGORY_KIND_LABELS = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
} as const

/**
 * Builds account filter options from the list accounts visible to the transaction list
 */
export function getAccountOptions(accounts: TransactionListAccount[] | undefined): OptionItem[] {
  return (accounts ?? []).map((account) => ({
    value: account.id,
    label: account.name ?? 'Unnamed account',
  }))
}

/**
 * Builds category filter options grouped by transaction category kind
 */
export function getCategoryOptions(categories: Category[] | undefined): OptionItem[] {
  return (['expense', 'income', 'transfer'] as const).flatMap((kind) =>
    (categories ?? [])
      .filter((category) => category.kind === kind)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((category) => ({
        value: category.id,
        label: category.name,
        group: CATEGORY_KIND_LABELS[kind],
        icon: category.icon ?? DEFAULT_TRANSACTION_CATEGORY_ICON,
      })),
  )
}

/**
 * Counts active transaction list filters while respecting fixed-account pages
 */
export function getActiveFilterCount(
  filters: TransactionListFilters,
  showAccountFilter: boolean,
): number {
  return [
    showAccountFilter && filters.account_id,
    filters.category_id,
    filters.from_date || filters.to_date,
  ].filter(Boolean).length
}
