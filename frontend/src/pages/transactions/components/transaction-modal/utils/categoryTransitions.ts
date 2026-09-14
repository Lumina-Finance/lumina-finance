import type { Category } from '@/api/categories'
import {
  BALANCE_ADJUSTMENT_CATEGORY_NAME,
  doesTransferRecordCounterpartyAccount,
} from '@/utils/transfers'
import type {
  TransactionFormValues,
  TransactionModalKind,
} from '@/pages/transactions/components/transaction-modal/types'

export interface CategorySelectionTransition {
  nextKind: TransactionModalKind
  fields: Partial<TransactionFormValues>
}

/**
 * Reports whether the modal treats a category as Balance Adjustment
 */
export function isModalBalanceAdjustmentCategory(category: Category | undefined): boolean {
  return category?.kind === 'transfer' && category.name === BALANCE_ADJUSTMENT_CATEGORY_NAME
}

/**
 * Builds the kind and form fields applied when an existing category is selected
 */
export function getCategorySelectionTransition(
  category: Category | undefined,
  categoryId: string,
  fallbackKind: TransactionModalKind,
): CategorySelectionTransition {
  const nextKind = (category?.kind as TransactionModalKind | undefined) ?? fallbackKind
  const isBalanceAdjustmentCategory = isModalBalanceAdjustmentCategory(category)

  return {
    nextKind,
    fields: {
      category_id: categoryId,
      ...(doesTransferRecordCounterpartyAccount(nextKind, isBalanceAdjustmentCategory)
        ? {}
        : { counterparty_account_id: '', symmetric_transfer: false }),
    },
  }
}
