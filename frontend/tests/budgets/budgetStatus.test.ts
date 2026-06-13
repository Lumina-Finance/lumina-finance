/**
 * Tests budget attention status thresholds so cards and details summaries classify utilization consistently
 */
import { describe, expect, it } from 'vitest'
import type { Budget, BudgetUtilization } from '@/api/budgets'
import { attentionState } from '@/budgets/utils/budgetStatus'

/**
 * Creates a budget period fixture with a positive limit
 */
function createBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: overrides.id ?? 'budget',
    base_budget_id: 'base-budget',
    period_start: '2026-06-01',
    period_end: '2026-06-30',
    overall_limit: overrides.overall_limit ?? 100000,
    created_at: '2026-06-01T00:00:00Z',
    base_budget: {
      id: 'base-budget',
      owner_id: null,
      group_id: null,
      name: 'Groceries',
      currency: 'CAD',
      recurrence_freq: 'monthly',
      instance_length: 1,
      recurrence_weekday: null,
      recurrence_dom: 1,
      recurrence_month: null,
      recurs: true,
      created_at: '2026-01-01T00:00:00Z',
      category_ids: ['groceries'],
    },
    ...overrides,
  }
}

/**
 * Creates a utilization fixture with configurable spend
 */
function createUtilization(totalSpent: number): BudgetUtilization {
  return {
    budget_id: 'budget',
    period_start: '2026-06-01',
    period_end: '2026-06-30',
    overall_limit: 100000,
    total_spent: totalSpent,
    categories: [],
    fx_status: { state: 'none', missing_pairs: [] },
  }
}

describe('budget attention status', () => {
  it('requires attention when latest period data is missing', () => {
    expect(attentionState(undefined, undefined).label).toBe('Needs attention')
  })

  it('classifies utilization below the warning threshold as on track', () => {
    expect(attentionState(createBudget(), createUtilization(50000)).label).toBe('On track')
  })

  it('classifies utilization at the warning threshold as watch', () => {
    expect(attentionState(createBudget(), createUtilization(80000)).label).toBe('Watch')
  })

  it('classifies full utilization as needing attention', () => {
    expect(attentionState(createBudget(), createUtilization(100000)).label).toBe('Needs attention')
  })
})
