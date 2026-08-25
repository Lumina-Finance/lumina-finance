/**
 * Tests the budget limit line and the label at the same height, so the line keeps the red every
 * chart mark uses while the label keeps the one a reader needs against the page
 */
import { describe, expect, it } from 'vitest'
import {
  OVER_BUDGET_LIMIT_LABEL_COLOR,
  OVER_BUDGET_LIMIT_LINE_COLOR,
  OVER_BUDGET_LIMIT_LINE_PCT,
} from '@/pages/budgets/components/budget-details-modal/budgetChartAxis'

describe('budget limit line', () => {
  it('draws the line and writes its label in different reds', () => {
    expect(OVER_BUDGET_LIMIT_LINE_COLOR).toBe('var(--app-chart-negative)')
    expect(OVER_BUDGET_LIMIT_LABEL_COLOR).toBe('var(--app-negative)')
    expect(OVER_BUDGET_LIMIT_LINE_COLOR).not.toBe(OVER_BUDGET_LIMIT_LABEL_COLOR)
  })

  it('puts both at the utilization a budget is spent up to', () => {
    expect(OVER_BUDGET_LIMIT_LINE_PCT).toBe(100)
  })
})
