import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { BudgetFormFieldErrors, BudgetFormState } from '@/pages/budgets/types'
import { toMinorUnits } from '@/pages/budgets/utils/money'

/**
 * Validates the create-budget form against frontend and backend budget requirements
 */
export function validateBudgetCreateForm(
  form: BudgetFormState,
  currencies: Currency[],
  expenseCategories: Category[],
): BudgetFormFieldErrors {
  const errors: BudgetFormFieldErrors = {}
  const instanceLength = Number(form.instanceLength)
  const hasSelectedExpenseCategory = form.categoryIds.some((categoryId) =>
    expenseCategories.some((category) => category.id === categoryId),
  )

  if (!form.name.trim()) errors.name = 'Name is required'
  if (!form.currency || !currencies.some((currency) => currency.id === form.currency)) {
    errors.currency = 'Select a currency'
  }
  if (toMinorUnits(form.limit, currencies, form.currency) === null) {
    errors.limit = 'Limit must be greater than zero'
  }
  if (!form.periodStart) errors.periodStart = 'Choose a period start'
  if (form.recurs && (!Number.isInteger(instanceLength) || instanceLength < 1)) {
    errors.instanceLength = 'Enter at least 1'
  }
  if (!hasSelectedExpenseCategory) errors.categoryIds = 'Select at least one category'

  return errors
}
