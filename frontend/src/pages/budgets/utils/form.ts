import type { BudgetEditorModalFieldIds } from '@/pages/budgets/components/budget-editor-modal/types'
import type { BudgetFormFieldErrors } from '@/pages/budgets/types'

/** The fields the budget editor can refuse, in the order it draws them */
export const BUDGET_FORM_FIELD_ORDER: readonly (keyof BudgetFormFieldErrors)[] = [
  'name',
  'currency',
  'limit',
  'instanceLength',
  'periodStart',
  'categoryIds',
]

/**
 * The control that takes focus when a field is refused. A missing category is fixed from the category
 * list, which its search field leads into
 */
export function getBudgetControlIds(ids: BudgetEditorModalFieldIds): Record<keyof BudgetFormFieldErrors, string> {
  return {
    name: ids.name,
    currency: ids.currency,
    limit: ids.limit,
    instanceLength: ids.interval,
    periodStart: ids.periodStart,
    categoryIds: ids.categorySearch,
  }
}

/**
 * Compares string selections as sets because category IDs should be unique before they reach the form
 */
export function sameStringSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const values = new Set(a)
  return b.every((value) => values.has(value))
}

/**
 * Id of the validation message a budget editor's label row shows for a field, which the field names as its
 * description
 */
export function budgetFieldErrorId(fieldId: string) {
  return `${fieldId}-error`
}
