import type { BaseBudget, Budget } from '@/api/budgets'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { BudgetFormFieldErrors, BudgetFormState } from '@/pages/budgets/types'
import { sameStringSet } from '@/pages/budgets/utils/form'
import { countRecurringPeriodsThrough, recurrenceAnchorsFromStart } from '@/pages/budgets/utils/budgetPeriods'
import {
  BUDGET_PERIOD_LIMIT_ERROR,
  BUDGET_REPEAT_LIMIT_REASON,
  MAX_BUDGET_PERIODS,
  getBudgetCategoryLimitError,
} from '@/utils/budgetLimits'
import { toMinorUnits } from '@/pages/budgets/utils/money'
import { getDateWindowError } from '@/utils/dateWindow'

/** Shown in Tracked categories whenever no expense category is chosen */
export const NO_CATEGORY_ERROR = 'Select at least one category'

/**
 * Whether a recurring budget's periods from its start to today would pass the most one keeps. A period
 * length that is not a whole number of at least 1 has its own error, so it is not counted
 */
function isPastPeriodLimit(form: BudgetFormState, instanceLength: number, todayYmd: string) {
  if (!Number.isInteger(instanceLength) || instanceLength < 1) return false

  const cadence = {
    recurrence_freq: form.recurrenceFreq,
    instance_length: instanceLength,
    recurrence_dom: recurrenceAnchorsFromStart(form.recurrenceFreq, form.periodStart).recurrence_dom,
  }
  const count = countRecurringPeriodsThrough(cadence, form.periodStart, todayYmd, MAX_BUDGET_PERIODS)
  return count !== null && count > MAX_BUDGET_PERIODS
}

/**
 * Why a one-off budget can't be made recurring, or undefined when it can. Repeating adds a period for each
 * step from its latest period to today, so a latest period too far back would pass the most a budget keeps.
 * A group's budgets keep every period, as on the server
 */
export function getRepeatLimitReason(
  baseBudget: Pick<BaseBudget, 'recurs' | 'group_id' | 'recurrence_freq' | 'instance_length' | 'recurrence_dom'>,
  latestPeriod: Pick<Budget, 'period_start'> | undefined,
  todayYmd: string,
) {
  if (baseBudget.recurs || baseBudget.group_id !== null || !latestPeriod) return undefined

  const count = countRecurringPeriodsThrough(baseBudget, latestPeriod.period_start, todayYmd, MAX_BUDGET_PERIODS)
  return count !== null && count > MAX_BUDGET_PERIODS ? BUDGET_REPEAT_LIMIT_REASON : undefined
}

/**
 * Validates the create-budget form against frontend and backend budget requirements
 */
export function validateBudgetCreateForm(
  form: BudgetFormState,
  currencies: Currency[],
  expenseCategories: Category[],
  todayYmd: string,
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
  else {
    // A start far in the past would make a period for every cadence step since, so it is held to the window every date must sit in
    const windowError = getDateWindowError(form.periodStart, todayYmd)
    if (windowError) errors.periodStart = windowError
    else if (form.recurs && isPastPeriodLimit(form, instanceLength, todayYmd))
      errors.periodStart = BUDGET_PERIOD_LIMIT_ERROR
  }
  if (form.recurs && (!Number.isInteger(instanceLength) || instanceLength < 1)) {
    errors.instanceLength = 'Enter at least 1'
  }
  if (!hasSelectedExpenseCategory) errors.categoryIds = NO_CATEGORY_ERROR
  else {
    const categoryLimitError = getBudgetCategoryLimitError(form.categoryIds.length)
    if (categoryLimitError) errors.categoryIds = categoryLimitError
  }

  return errors
}

/**
 * The refusal shown on an edit form's category field, or undefined when the categories are fine. A budget
 * already past the limit still saves while its categories stay as the saved ones
 *
 * @param selectedIds - The categories chosen in the form
 * @param savedIds - The categories the budget tracks now
 * @param hasCategory - Whether any chosen category is one the form can list
 */
export function getEditCategoryError(selectedIds: string[], savedIds: string[], hasCategory: boolean) {
  if (!hasCategory) return NO_CATEGORY_ERROR
  return getBudgetCategoryLimitError(selectedIds.length, !sameStringSet(selectedIds, savedIds)) ?? undefined
}

/**
 * The error on the create form's category field. A pick past the limit shows at once, as well as on submit,
 * since the person has just made it so
 *
 * @param selectedCount - Categories chosen in the form
 * @param shownError - What the form shows by its own rules, after a refused submit or leaving the field
 */
export function getCreateCategoryError(selectedCount: number, shownError: string | undefined) {
  return getBudgetCategoryLimitError(selectedCount) ?? shownError
}
