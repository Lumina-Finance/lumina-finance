/**
 * Tests the refusals of an import's budgets step: more budgets than the person may still add, a
 * budget tracking more categories than one can, and a count that is not yet known
 */
import { describe, expect, it } from 'vitest'
import { getBudgetCountCheck, getProviderBudgetSelectionError } from '@/pages/imports/utils/providerImportRun'
import { getExistingBudgetCount } from '@/utils/budgetLimits'

/** Creates the given number of selected budgets, each tracking one category */
function selectBudgets(count: number) {
  return Array.from({ length: count }, (_, index) => ({ name: `Budget ${index}`, categoryCount: 1 }))
}

describe('the import budgets step refusals', () => {
  it('takes budgets up to the most the person may still add', () => {
    expect(getProviderBudgetSelectionError(selectBudgets(100), 0, false, null)).toBeNull()
    expect(getProviderBudgetSelectionError(selectBudgets(1), 99, false, null)).toBeNull()
    expect(getProviderBudgetSelectionError([], 100, false, null)).toBeNull()
  })

  it('refuses a selection past the budgets the person may still add, with how many that is', () => {
    expect(getProviderBudgetSelectionError(selectBudgets(101), 0, false, null)).toBe(
      'Please select at most 100 budgets to import, since you can keep up to 100 and already have 0.',
    )
    expect(getProviderBudgetSelectionError(selectBudgets(2), 99, false, null)).toBe(
      'Please select at most 1 budget to import, since you can keep up to 100 and already have 99.',
    )
  })

  it('refuses any selection from someone who already has 100 or more budgets', () => {
    expect(getProviderBudgetSelectionError(selectBudgets(1), 100, false, null)).toBe(
      'You can keep up to 100 budgets and already have 100, so none can be imported. Please unselect them to import the rest.',
    )
    expect(getProviderBudgetSelectionError(selectBudgets(1), 105, false, null)).toBe(
      'You can keep up to 100 budgets and already have 105, so none can be imported. Please unselect them to import the rest.',
    )
  })

  it('refuses a selected budget tracking more than 100 categories, naming it', () => {
    expect(getProviderBudgetSelectionError([{ name: 'Everything', categoryCount: 100 }], 0, false, null)).toBeNull()
    expect(getProviderBudgetSelectionError([{ name: 'Everything', categoryCount: 101 }], 0, false, null)).toBe(
      'Everything tracks 101 categories, and a budget can track up to 100. Please unselect it to import the rest.',
    )
  })

  it('reports why the budgets cannot be built when the counts are fine', () => {
    expect(getProviderBudgetSelectionError(selectBudgets(1), 0, false, 'A limit is not a number')).toBe(
      'A limit is not a number',
    )
  })

  it('holds a selection back while the count of budgets has no data, and says why', () => {
    expect(getProviderBudgetSelectionError(selectBudgets(1), null, false, null)).toBe(
      'Checking how many budgets you already have.',
    )
    expect(getProviderBudgetSelectionError(selectBudgets(1), null, true, null)).toBe(
      "Your budgets couldn't be loaded, so the selected budgets can't be checked. Please try again, or unselect them to import the rest.",
    )
  })

  it('names what the selection waits on, which the step shows apart from an error', () => {
    expect(getBudgetCountCheck(null, false, 1)).toBe('checking')
    expect(getBudgetCountCheck(null, true, 1)).toBe('failed')
    expect(getBudgetCountCheck(null, true, 0)).toBeNull()
    expect(getBudgetCountCheck(0, true, 1)).toBeNull()
  })

  it('reads the count as null until the list of budgets has data', () => {
    expect(getExistingBudgetCount(undefined)).toBeNull()
    expect(getExistingBudgetCount([])).toBe(0)
    expect(getExistingBudgetCount([{ group_id: null }, { group_id: 'group-1' }])).toBe(1)
  })

  it('refuses nothing for an empty selection while the count has no data', () => {
    expect(getProviderBudgetSelectionError([], null, false, null)).toBeNull()
    expect(getProviderBudgetSelectionError([], null, true, null)).toBeNull()
  })
})
