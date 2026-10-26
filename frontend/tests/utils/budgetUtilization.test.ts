/**
 * Tests budget utilization math so cards, summaries, and status labels handle zero limits consistently
 */
import { describe, expect, it } from 'vitest'
import { getBudgetUtilizationLabelPercent, getBudgetUtilizationPercent } from '@/utils/budgetUtilization'

describe('budget utilization helpers', () => {
  it('calculates utilization as a percentage of the budget limit', () => {
    expect(getBudgetUtilizationPercent(2500, 10000)).toBe(25)
  })

  it('writes the spent share of a limit rounded up', () => {
    expect(getBudgetUtilizationLabelPercent(1, 3)).toBe(34)
    expect(getBudgetUtilizationLabelPercent(2500, 10000)).toBe(25)
    expect(getBudgetUtilizationLabelPercent(2500, 0)).toBe(0)
  })

  it('treats zero and negative limits as unused budgets', () => {
    expect(getBudgetUtilizationPercent(2500, 0)).toBe(0)
    expect(getBudgetUtilizationPercent(2500, -1000)).toBe(0)
  })
})
