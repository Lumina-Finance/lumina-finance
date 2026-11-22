/**
 * Tests the budget and category limits: the add control held off at 100 budgets with its reason, and
 * the field refusing a 101st category
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import type { BudgetFormState } from '@/pages/budgets/types'
import {
  getCreateCategoryError,
  getEditCategoryError,
  validateBudgetCreateForm,
} from '@/pages/budgets/utils/budgetFormValidation'
import { countOwnedBaseBudgets, getBudgetCategoryLimitError, getBudgetCountLimitReason } from '@/utils/budgetLimits'

const BUDGET_REASON = 'You can keep up to 100 budgets. Please delete one to add another.'
const CATEGORY_ERROR = 'Select up to 100 categories'

const currencies: Currency[] = [{ id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 }]

/** Creates the given number of expense categories named by their position */
function createCategories(count: number): Category[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `category-${index}`,
    group_id: null,
    owner_id: null,
    name: `Category ${index}`,
    kind: 'expense',
    icon: null,
    is_system: false,
    created_at: '2026-01-01T00:00:00Z',
  }))
}

/** Creates a valid create-budget form tracking the given categories */
function createForm(categories: Category[]): BudgetFormState {
  return {
    name: 'Groceries',
    currency: 'CAD',
    categoryIds: categories.map((category) => category.id),
    limit: '1000.50',
    recurrenceFreq: 'monthly',
    instanceLength: '1',
    periodStart: '2026-06-01',
    recurs: true,
  }
}

describe('the most budgets a person keeps', () => {
  it('counts the budgets they own, archived included, and leaves a group budgets out', () => {
    const owned = { group_id: null }
    const group = { group_id: 'group-1' }

    expect(countOwnedBaseBudgets(undefined)).toBe(0)
    expect(countOwnedBaseBudgets([owned, owned, group])).toBe(2)
  })

  it('holds the add control off from 100 budgets with the reason, and not before', () => {
    expect(getBudgetCountLimitReason(99)).toBeNull()
    expect(getBudgetCountLimitReason(100)).toBe(BUDGET_REASON)
    expect(getBudgetCountLimitReason(105)).toBe(BUDGET_REASON)

    const available = renderToStaticMarkup(
      <DisabledReasonButton disabledReason={getBudgetCountLimitReason(99)}>New budget</DisabledReasonButton>,
    )
    const held = renderToStaticMarkup(
      <DisabledReasonButton disabledReason={getBudgetCountLimitReason(100)}>New budget</DisabledReasonButton>,
    )

    expect(available).not.toContain('aria-disabled')
    expect(held).toContain('aria-disabled="true"')
    expect(held).toContain(BUDGET_REASON)
  })
})

describe('the most categories a budget tracks', () => {
  it('refuses a 101st category on the field of the create form, and takes 100', () => {
    const errorFor = (count: number) => {
      const categories = createCategories(count)
      return validateBudgetCreateForm(createForm(categories), currencies, categories, '2026-06-10').categoryIds
    }

    expect(errorFor(100)).toBeUndefined()
    expect(errorFor(101)).toBe(CATEGORY_ERROR)
  })

  it('lets a budget already past the limit save while its categories stay as they are', () => {
    expect(getBudgetCategoryLimitError(100)).toBeNull()
    expect(getBudgetCategoryLimitError(101)).toBe(CATEGORY_ERROR)
    expect(getBudgetCategoryLimitError(101, false)).toBeNull()
  })
})

describe('the category field of the budget forms', () => {
  const ids = (count: number) => Array.from({ length: count }, (_, index) => `category-${index}`)

  it('shows a 101st pick on the create form at once, and otherwise what the form shows', () => {
    expect(getCreateCategoryError(101, undefined)).toBe(CATEGORY_ERROR)
    expect(getCreateCategoryError(100, undefined)).toBeUndefined()
    expect(getCreateCategoryError(100, 'Select at least one category')).toBe('Select at least one category')
  })

  it('lets a budget tracking 101 categories be renamed, with its categories unchanged', () => {
    const saved = ids(101)

    expect(getEditCategoryError([...saved].reverse(), saved, true)).toBeUndefined()
  })

  it('refuses a change that leaves the edit form with more than 100 categories', () => {
    expect(getEditCategoryError(ids(101), ids(100), true)).toBe(CATEGORY_ERROR)
    expect(getEditCategoryError(ids(102), ids(101), true)).toBe(CATEGORY_ERROR)
    expect(getEditCategoryError(ids(100), ids(101), true)).toBeUndefined()
  })

  it('asks for a category on the edit form before anything else', () => {
    expect(getEditCategoryError([], ids(3), false)).toBe('Select at least one category')
  })
})
