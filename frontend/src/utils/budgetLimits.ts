import type { BaseBudget } from '@/api/budgets'

// Most budgets a person keeps and most categories one tracks, mirroring the backend. The budgets page
// holds back its add control at the first, and the forms and the import refuse a pick past either
export const MAX_BASE_BUDGETS = 100
export const MAX_BUDGET_CATEGORIES = 100

// Most periods one budget keeps, mirroring the backend. The create form refuses a start date whose
// periods to today would pass it, the edit form holds back Recurring for a one-off budget that would,
// and the budget import refuses a budget with more limit periods
export const MAX_BUDGET_PERIODS = 1200

/** Shown on the start date when a recurring budget would start more periods back than a budget keeps */
export const BUDGET_PERIOD_LIMIT_ERROR = `A budget can go back at most ${MAX_BUDGET_PERIODS.toLocaleString('en-CA')} periods. Please choose a later start date.`

/** Why a one-off budget can't repeat, when repeating it would start more periods back than a budget keeps */
export const BUDGET_REPEAT_LIMIT_REASON = `This budget can't repeat: a budget can go back at most ${MAX_BUDGET_PERIODS.toLocaleString('en-CA')} periods.`

/**
 * Whether a budget is held to the most periods one keeps, as on the server. Only a person's own budgets
 * are, since a group's budget keeps every period its members see
 */
export function isPeriodLimited(baseBudget: Pick<BaseBudget, 'group_id'>) {
  return baseBudget.group_id === null
}

/**
 * Counts the budgets toward the most a person keeps. Those are the ones they own, archived included,
 * and a group's budgets belong to the group and are not counted
 */
export function countOwnedBaseBudgets(baseBudgets: readonly Pick<BaseBudget, 'group_id'>[] | undefined) {
  return (baseBudgets ?? []).filter((baseBudget) => baseBudget.group_id === null).length
}

/** Why no budget can be added, or null while the person is under the most they keep */
export function getBudgetCountLimitReason(ownedBudgetCount: number) {
  return ownedBudgetCount >= MAX_BASE_BUDGETS
    ? `You can keep up to ${MAX_BASE_BUDGETS} budgets. Please delete one to add another.`
    : null
}

/**
 * The refusal for a budget tracking too many categories, or null when it is within the limit.
 * A budget already past the limit keeps saving while its categories stay as they are, so a form
 * passes the categories' change as well
 */
export function getBudgetCategoryLimitError(selectedCount: number, isChanged = true) {
  return isChanged && selectedCount > MAX_BUDGET_CATEGORIES ? `Select up to ${MAX_BUDGET_CATEGORIES} categories` : null
}

/** The count of budgets a person keeps, or null while the list of them has no data */
export function getExistingBudgetCount(baseBudgets: readonly Pick<BaseBudget, 'group_id'>[] | undefined) {
  return baseBudgets ? countOwnedBaseBudgets(baseBudgets) : null
}
