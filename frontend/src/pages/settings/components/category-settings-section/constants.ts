import type { Category } from '@/api/categories'

export type CategoryKind = Category['kind']

export const KIND_LABELS: Record<CategoryKind, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
}

export const KIND_ORDER: CategoryKind[] = ['expense', 'income', 'transfer']
export const DEFAULT_CATEGORY_ICON = '🏷️'
export const DELETE_SPINNER_MS = 1000
export const EASE = [0.25, 0.1, 0.25, 1] as const
