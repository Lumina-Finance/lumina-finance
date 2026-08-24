import { useMemo } from 'react'
import type { Category } from '@/api/categories'
import { BALANCE_ADJUSTMENT_CATEGORY_NAME, doesTransferRecordCounterpartyAccount } from '@/utils/transfers'
import { buildCategoryOptions } from '@/pages/transactions/components/transaction-modal/utils/categories'
import {
  getCreditRepaymentSteer,
  type CreditRepaymentSteer,
} from '@/pages/transactions/components/transaction-modal/utils/creditRepayment'
import type {
  TransactionFormFieldErrors,
  TransactionFormValues,
  TransactionModalKind,
} from '@/pages/transactions/components/transaction-modal/types'

interface UseCategoryFieldOptions {
  categories: Category[]
  readOnly: boolean
  form: TransactionFormValues
  applyKindChange: (nextKind: TransactionModalKind, fields?: Partial<TransactionFormValues>) => void
  clearError: (field: keyof TransactionFormFieldErrors) => void
  closeModal: () => void
}

interface CategoryFieldState {
  categoryById: Map<string, Category>
  categoryOptions: ReturnType<typeof buildCategoryOptions>
  selectedCategory: Category | undefined
  isBalanceAdjustmentCategory: boolean
  creditRepaymentSteer: CreditRepaymentSteer
  handleCategoryChange: (categoryId: string) => void
  handleCategoryCreated: (category: Category) => void
}

/**
 * Owns category selection, the category-driven kind switch, and inline category creation
 */
export function useCategoryField({
  categories,
  readOnly,
  form,
  applyKindChange,
  clearError,
  closeModal,
}: UseCategoryFieldOptions): CategoryFieldState {
  const categoryById = useMemo(() => {
    const map = new Map<string, Category>()
    categories.forEach((c) => map.set(c.id, c))
    return map
  }, [categories])

  const categoryOptions = useMemo(
    () => buildCategoryOptions(categories, form.kind),
    [categories, form.kind],
  )

  const selectedCategory = form.category_id ? categoryById.get(form.category_id) : undefined

  // The synthetic balance adjustment category never counts toward cash flow, so warn when it is picked
  const isBalanceAdjustmentCategory = !!(
    selectedCategory?.is_system &&
    selectedCategory.name === BALANCE_ADJUSTMENT_CATEGORY_NAME
  )

  const creditRepaymentSteer = getCreditRepaymentSteer(selectedCategory, categories, readOnly)

  const handleCategoryChange = (categoryId: string) => {
    const category = categoryById.get(categoryId)
    const nextKind = (category?.kind as TransactionModalKind | undefined) ?? form.kind
    const nextIsBalanceAdjustment = !!(category?.is_system && category.name === BALANCE_ADJUSTMENT_CATEGORY_NAME)
    // Auto-switch the kind toggle to match the chosen category. Balance Adjustment has no
    // counterparty, so a pending counterparty-account answer or a symmetric pair set up under a
    // real transfer category no longer applies once the category switches to it
    applyKindChange(nextKind, {
      category_id: categoryId,
      ...(doesTransferRecordCounterpartyAccount(nextKind, nextIsBalanceAdjustment)
        ? {}
        : { counterparty_account_id: '', symmetric_transfer: false }),
    })
    clearError('category_id')
  }

  const handleCategoryCreated = (category: Category) => {
    applyKindChange(category.kind as TransactionModalKind, { category_id: category.id })
    clearError('category_id')
    closeModal()
  }

  return {
    categoryById,
    categoryOptions,
    selectedCategory,
    isBalanceAdjustmentCategory,
    creditRepaymentSteer,
    handleCategoryChange,
    handleCategoryCreated,
  }
}
