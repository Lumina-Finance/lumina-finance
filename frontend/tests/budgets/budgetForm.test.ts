/**
 * Tests budget form helpers so currency input, category validation, and category set comparisons catch invalid payloads before API calls
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { BudgetFormState } from '@/pages/budgets/types'
import { validateBudgetCreateForm } from '@/pages/budgets/utils/budgetCreateValidation'
import { sameStringSet } from '@/pages/budgets/utils/form'
import {
  formatMinorUnitsInput,
  toMinorUnits,
} from '@/pages/budgets/utils/money'

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
    limit: '1,000.50',
    recurrenceFreq: 'monthly',
    instanceLength: '1',
    periodStart: '2026-06-01',
    recurs: true,
    ...overrides,
  }
}

describe('budget form helpers', () => {
  it('converts between decimal inputs and currency minor units', () => {
    expect(toMinorUnits('1,234.56', currencies, 'CAD')).toBe(123456)
    expect(toMinorUnits('1234.56', currencies, 'JPY')).toBe(1235)
    expect(toMinorUnits('0', currencies, 'CAD')).toBeNull()
    expect(formatMinorUnitsInput(123456, currencies, 'CAD')).toBe('1,234.56')
  })

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

  it('compares selected category IDs without depending on order', () => {
    expect(sameStringSet(['travel', 'groceries'], ['groceries', 'travel'])).toBe(true)
    expect(sameStringSet(['travel'], ['travel', 'groceries'])).toBe(false)
  })
})
