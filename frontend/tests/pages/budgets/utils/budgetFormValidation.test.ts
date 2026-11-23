/**
 * Tests create-budget validation, so an invalid form is caught with a message against each field
 * before any API call is made
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { BudgetFormState } from '@/pages/budgets/types'
import { getRepeatLimitReason, validateBudgetCreateForm } from '@/pages/budgets/utils/budgetFormValidation'

// A fixed today, since the far edge of the window moves with it
const TODAY = '2026-06-10'

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
    expect(validateBudgetCreateForm(createForm(), currencies, categories, TODAY)).toEqual({})
    expect(
      validateBudgetCreateForm(
        createForm({
          name: ' ',
          currency: 'BAD',
          categoryIds: [],
          limit: '0',
          periodStart: '',
          instanceLength: '0',
        }),
        currencies,
        categories,
        TODAY,
      ),
    ).toEqual({
      name: 'Name is required',
      currency: 'Select a currency',
      limit: 'Limit must be greater than zero',
      periodStart: 'Choose a period start',
      instanceLength: 'Enter at least 1',
      categoryIds: 'Select at least one category',
    })
  })

  it('refuses a start outside the window every date must sit in, on the start field', () => {
    // One-off, so a start in 1900 makes a single period and only the window decides
    const startError = (periodStart: string) =>
      validateBudgetCreateForm(createForm({ periodStart, recurs: false }), currencies, categories, TODAY).periodStart

    expect(startError('2024-01-01')).toBeUndefined()
    expect(startError('1900-01-01')).toBeUndefined()
    expect(startError('2036-06-10')).toBeUndefined()
    expect(startError('1850-01-01')).toBe('Must be on or after Jan 1, 1900')
    expect(startError('2040-01-01')).toBe('Must be within ten years of today')
  })

  it('refuses a recurring start whose periods to today pass 1,200, on the start field', () => {
    // The same today and dates as the backend's period limit service tests, so the two counts cannot drift apart
    const periodLimitToday = '2026-05-04'
    const startError = (overrides: Partial<BudgetFormState>) =>
      validateBudgetCreateForm(createForm(overrides), currencies, categories, periodLimitToday).periodStart
    const refusal = 'A budget can go back at most 1,200 periods. Please choose a later start date.'

    expect(startError({ periodStart: '1976-06-01' }), '600 monthly periods').toBeUndefined()
    expect(startError({ periodStart: '1926-06-01' }), '1,200 monthly periods').toBeUndefined()
    expect(startError({ periodStart: '1926-05-01' }), '1,201 monthly periods').toBe(refusal)
    expect(startError({ periodStart: '1926-05-31' }), '1,200 periods on day 31').toBeUndefined()
    expect(startError({ periodStart: '1926-03-31' }), '1,202 periods on day 31').toBe(refusal)
    expect(startError({ periodStart: '2003-05-12', recurrenceFreq: 'weekly' }), '1,200 weeks').toBeUndefined()
    expect(startError({ periodStart: '2003-05-05', recurrenceFreq: 'weekly' }), '1,201 weeks').toBe(refusal)
    expect(startError({ periodStart: '1996-05-06', recurrenceFreq: 'weekly' }), '30 years of weeks').toBe(refusal)
    expect(startError({ periodStart: '1926-05-01', instanceLength: '2' }), '601 two-month periods').toBeUndefined()
    expect(startError({ periodStart: '1926-05-01', recurs: false }), 'one-off').toBeUndefined()
  })
})

describe('repeat limit for a one-off budget', () => {
  // The same today and dates as the backend's switch-to-recurring tests
  const today = '2026-05-04'
  const oneOffWeekly = {
    recurs: false,
    group_id: null,
    recurrence_freq: 'weekly' as const,
    instance_length: 1,
    recurrence_dom: null,
  }
  const reason = "This budget can't repeat: a budget can go back at most 1,200 periods."

  it('holds back Recurring only when repeating would pass 1,200 periods', () => {
    expect(getRepeatLimitReason(oneOffWeekly, { period_start: '2003-05-12' }, today), '1,200 weeks').toBeUndefined()
    expect(getRepeatLimitReason(oneOffWeekly, { period_start: '2003-05-05' }, today), '1,201 weeks').toBe(reason)
  })

  it('leaves a recurring budget, a group budget and a budget with no period free to repeat', () => {
    const old = { period_start: '1990-01-01' }
    expect(getRepeatLimitReason({ ...oneOffWeekly, recurs: true }, old, today)).toBeUndefined()
    expect(getRepeatLimitReason({ ...oneOffWeekly, group_id: 'family' }, old, today)).toBeUndefined()
    expect(getRepeatLimitReason(oneOffWeekly, undefined, today)).toBeUndefined()
  })
})
