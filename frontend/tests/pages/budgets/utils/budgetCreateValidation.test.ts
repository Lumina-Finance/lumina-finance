/**
 * Tests create-budget validation, so an invalid form is caught with a message against each field
 * before any API call is made
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { BudgetFormState } from '@/pages/budgets/types'
import { validateBudgetCreateForm } from '@/pages/budgets/utils/budgetCreateValidation'

const currencies: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese Yen', symbol: '¥', minor_unit_exponent: 0 },
]

const categories: Category[] = [
  {
    id: 'groceries',
    group_id: null,
    owner_id: null,
    name: 'Groceries',
    kind: 'expense',
    icon: null,
    is_system: false,
    created_at: '2026-01-01T00:00:00Z',
  },
]

/**
 * Creates a valid create-budget form fixture
 */
function createForm(overrides: Partial<BudgetFormState> = {}): BudgetFormState {
  return {
    name: 'Groceries',
    currency: 'CAD',
    categoryIds: ['groceries'],
    limit: '1000.50',
    recurrenceFreq: 'monthly',
    instanceLength: '1',
    periodStart: '2026-06-01',
    recurs: true,
    ...overrides,
  }
}

describe('create budget validation', () => {
  it('validates create-budget fields before building an API payload', () => {
    expect(validateBudgetCreateForm(createForm(), currencies, categories)).toEqual({})
    expect(validateBudgetCreateForm(createForm({
      name: ' ',
      currency: 'BAD',
      categoryIds: [],
      limit: '0',
      periodStart: '',
      instanceLength: '0',
    }), currencies, categories)).toEqual({
      name: 'Name is required',
      currency: 'Select a currency',
      limit: 'Limit must be greater than zero',
      periodStart: 'Choose a period start',
      instanceLength: 'Enter at least 1',
      categoryIds: 'Select at least one category',
    })
  })
})
