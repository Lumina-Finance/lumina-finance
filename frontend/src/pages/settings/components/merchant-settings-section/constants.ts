import type { Category } from '@/api/categories'
import { NO_DEFAULT_CATEGORY_VALUE } from '@/components/reference-modals/CreateMerchantModal'

export const DELETE_SPINNER_MS = 800
export const NO_CATEGORY_VALUE = NO_DEFAULT_CATEGORY_VALUE
export const EASE = [0.25, 0.1, 0.25, 1] as const
export const LOADING_TEXT_MIN_MS = 300
export const FETCHING_MORE_TEXT_MIN_MS = 800
export const MERCHANT_SEARCH_DEBOUNCE_MS = 300
export const MERCHANT_LIST_VISIBLE_ROWS = 10
export const MERCHANT_LIST_PAGE_SIZE = MERCHANT_LIST_VISIBLE_ROWS
export const MERCHANT_MERGE_PAGE_SIZE = 10
export const MERCHANT_ROW_EXIT = { opacity: 0, y: -6, scale: 0.985 }
export const MERCHANT_ROW_EXIT_TRANSITION = { duration: 0.24, ease: EASE }
export const CATEGORY_KIND_LABELS: Record<Category['kind'], string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
}
export const CATEGORY_KIND_ORDER: Category['kind'][] = ['expense', 'income', 'transfer']
