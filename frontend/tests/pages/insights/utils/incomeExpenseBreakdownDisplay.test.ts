/**
 * Covers the slice percentages beside the income and expense pies, so a share of expenses rounds up
 * and a share of income rounds down, like the amounts they are shares of
 */
import { describe, expect, it } from 'vitest'
import { getBreakdownPercent } from '@/pages/insights/utils/incomeExpenseBreakdownDisplay'

describe('breakdown slice percent', () => {
  it('rounds a share of expenses up and a share of income down', () => {
    expect(getBreakdownPercent(1, 3, 'expense')).toBe(34)
    expect(getBreakdownPercent(1, 3, 'income')).toBe(33)
  })

  it('leaves an exact share alone and reads an empty total as zero', () => {
    expect(getBreakdownPercent(25, 100, 'expense')).toBe(25)
    expect(getBreakdownPercent(5, 0, 'income')).toBe(0)
  })
})
