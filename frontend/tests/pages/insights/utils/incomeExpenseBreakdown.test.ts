/**
 * Covers the category trend rows, so the change in percent is worked out from the two amounts and
 * rounds by the card's mode: a rise in spending up, and a rise in income down
 */
import { describe, expect, it } from 'vitest'
import type { InsightsIncomeExpenseBreakdownResponse } from '@/api/insights'
import { getCategoryTrendSections } from '@/pages/insights/utils/incomeExpenseBreakdown'

// 1,125 against 1,000 is a rise of 12.5%, and 875 against 1,000 is a fall of 12.5%
const response = {
  expense_increases: [['a', 'Dining', 1_125, 1_000, 1]],
  expense_decreases: [['b', 'Travel', 875, 1_000, 1]],
  income_increases: [['c', 'Salary', 1_125, 1_000, 1]],
  income_decreases: [['d', 'Bonus', 875, 1_000, 1]],
} as unknown as InsightsIncomeExpenseBreakdownResponse

describe('category trend sections', () => {
  it('rounds a rise and a fall in spending up', () => {
    const [increases, decreases] = getCategoryTrendSections(response, 'expense')

    expect(increases.drivers[0].changePct).toBe(13)
    expect(decreases.drivers[0].changePct).toBe(-12)
  })

  it('rounds a rise and a fall in income down', () => {
    const [increases, decreases] = getCategoryTrendSections(response, 'income')

    expect(increases.drivers[0].changePct).toBe(12)
    expect(decreases.drivers[0].changePct).toBe(-13)
  })

  it('has no percent for a category with no previous amount', () => {
    const [increases] = getCategoryTrendSections({
      expense_increases: [['a', 'Dining', 500, 0, 1]],
    } as unknown as InsightsIncomeExpenseBreakdownResponse, 'expense')

    expect(increases.drivers[0].changePct).toBeNull()
  })
})
