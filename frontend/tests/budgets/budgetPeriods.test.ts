/**
 * Tests budget period helpers so recurrence anchors, card previews, and automatic backfill stay aligned with backend period rules
 */
import { describe, expect, it } from 'vitest'
import type { BaseBudget, Budget } from '@/api/budgets'
import type { BudgetFormState } from '@/pages/budgets/types'
import {
  budgetCadenceLabel,
  cadenceSummary,
  missingRecurringPeriodStarts,
  nextBudgetPeriods,
  oneOffPeriodEnd,
  recurrenceAnchorsFromStart,
} from '@/pages/budgets/utils/budgetPeriods'

/**
 * Creates a recurring monthly base budget fixture
 */
function createBaseBudget(overrides: Partial<BaseBudget> = {}): BaseBudget {
  return {
    id: overrides.id ?? 'base-budget',
    owner_id: null,
    group_id: null,
    name: overrides.name ?? 'Groceries',
    currency: 'CAD',
    recurrence_freq: 'monthly',
    instance_length: 1,
    recurrence_weekday: null,
    recurrence_dom: 1,
    recurrence_month: null,
    recurs: true,
    created_at: '2026-01-01T00:00:00Z',
    category_ids: ['groceries'],
    ...overrides,
  }
}

/**
 * Creates a budget period fixture tied to the supplied base budget
 */
function createBudget(baseBudget: BaseBudget, overrides: Partial<Budget> = {}): Budget {
  return {
    id: overrides.id ?? 'budget-period',
    base_budget_id: baseBudget.id,
    period_start: overrides.period_start ?? '2026-06-01',
    period_end: overrides.period_end ?? '2026-06-30',
    overall_limit: overrides.overall_limit ?? 100000,
    created_at: '2026-06-01T00:00:00Z',
    base_budget: baseBudget,
    ...overrides,
  }
}

/**
 * Creates a budget form fixture with valid recurring monthly defaults
 */
function createForm(overrides: Partial<BudgetFormState> = {}): BudgetFormState {
  return {
    name: 'Groceries',
    currency: 'CAD',
    categoryIds: ['groceries'],
    limit: '1,000.00',
    recurrenceFreq: 'monthly',
    instanceLength: '1',
    periodStart: '2026-06-01',
    recurs: true,
    ...overrides,
  }
}

describe('budget period helpers', () => {
  it('converts period starts into backend recurrence anchors', () => {
    expect(recurrenceAnchorsFromStart('weekly', '2026-06-15')).toEqual({
      recurrence_weekday: 0,
      recurrence_dom: null,
      recurrence_month: null,
    })
    expect(recurrenceAnchorsFromStart('monthly', '2026-06-15')).toEqual({
      recurrence_weekday: null,
      recurrence_dom: 15,
      recurrence_month: null,
    })
    expect(recurrenceAnchorsFromStart('yearly', '2026-06-15')).toEqual({
      recurrence_weekday: null,
      recurrence_dom: 15,
      recurrence_month: 6,
    })
  })

  it('summarizes one-off and recurring form cadence', () => {
    expect(oneOffPeriodEnd(createForm({ recurs: false, recurrenceFreq: 'monthly' }))).toEqual({
      year: 2026,
      month: 6,
      day: 30,
    })
    expect(cadenceSummary(createForm({ name: '  ', recurs: false }))).toBe('"Untitled" is one-off starting Jun 1, 2026 and ending Jun 30, 2026')
    expect(cadenceSummary(createForm({ recurrenceFreq: 'weekly', instanceLength: '2' }))).toBe('"Groceries" will repeat every 2 weeks starting Jun 1, 2026')
  })

  it('formats cadence labels and next budget period previews', () => {
    const baseBudget = createBaseBudget()
    const latestPeriod = createBudget(baseBudget)

    expect(budgetCadenceLabel(baseBudget)).toBe('Monthly')
    expect(nextBudgetPeriods(baseBudget, latestPeriod)).toEqual([
      'Jul 1, 2026 - Jul 31, 2026',
      'Aug 1, 2026 - Aug 31, 2026',
    ])
  })

  it('lists every elapsed recurring period start that needs backfill', () => {
    const baseBudget = createBaseBudget()
    const latestPeriod = createBudget(baseBudget)

    expect(missingRecurringPeriodStarts(baseBudget, latestPeriod, '2026-08-15')).toEqual([
      '2026-07-01',
      '2026-08-01',
    ])
  })
})
