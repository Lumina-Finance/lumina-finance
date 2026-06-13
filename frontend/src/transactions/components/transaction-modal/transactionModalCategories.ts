import type { Category } from '@/api/categories'
import {
  DEFAULT_CATEGORY_ICON,
  DEFAULT_DIRECTION_BY_KIND,
  KIND_LABELS,
} from '@/transactions/components/transaction-modal/transactionModalConstants'
import type {
  TransactionDirection,
  TransactionModalKind,
} from '@/transactions/components/transaction-modal/transactionModalTypes'

const CATEGORY_KIND_ORDER: TransactionModalKind[] = ['expense', 'income', 'transfer']

/**
 * Builds category dropdown options with the selected transaction kind shown first
 */
export function buildCategoryOptions(categories: Category[], selectedKind: TransactionModalKind) {
  const sortedKinds = [
    selectedKind,
    ...CATEGORY_KIND_ORDER.filter((kind) => kind !== selectedKind),
  ]

  return sortedKinds.flatMap((kind) => buildOptionsForKind(categories, kind))
}

/**
 * Gets the default direction for a transaction kind when the kind changes
 */
export function getDefaultDirectionForKind(kind: TransactionModalKind): TransactionDirection {
  return DEFAULT_DIRECTION_BY_KIND[kind]
}

function buildOptionsForKind(categories: Category[], kind: TransactionModalKind) {
  return categories
    .filter((category) => category.kind === kind)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((category) => ({
      value: category.id,
      label: category.name,
      group: KIND_LABELS[kind],
      icon: category.icon ?? DEFAULT_CATEGORY_ICON,
    }))
}
