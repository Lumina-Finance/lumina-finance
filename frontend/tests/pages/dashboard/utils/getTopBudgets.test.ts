/**
 * Tests the top budgets ranking, so the order and the usage percentages cannot drift from the exact
 * spend against each limit, rather than the rounded figure shown
 */
import { describe, expect, it } from 'vitest'
import { getTopBudgets } from '@/pages/dashboard/utils/getTopBudgets'
import { createBudget } from './fixtures'

describe('top budgets', () => {
  it('ranks top budgets by exact utilization', () => {
    const budgets = getTopBudgets([
      createBudget({
        budget_id: 'rounded-high',
        base_budget_id: 'base-rounded-high',
        name: 'Rounded high',
        total_spent: 504,
      }),
      createBudget({
        budget_id: 'rounded-low',
        base_budget_id: 'base-rounded-low',
        name: 'Rounded low',
        total_spent: 496,
      }),
      createBudget({
        budget_id: 'watch',
        base_budget_id: 'base-watch',
        name: 'Watch',
        total_spent: 800,
      }),
    ])

    expect(budgets.map((budget) => budget.budget_id)).toEqual(['watch', 'rounded-high', 'rounded-low'])
    expect(budgets.map((budget) => budget.usagePct)).toEqual([80, 50, 50])
  })
})
