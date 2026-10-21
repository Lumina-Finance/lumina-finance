/**
 * Tests the one savings rate every surface shares, so it rounds down from whole minor units and an
 * exact value is never read a hair off by a floating-point division
 */
import { describe, expect, it } from 'vitest'
import { getSavingsRate } from '@/utils/savingsRate'

describe('savings rate', () => {
  it('rounds an exact half down, not up', () => {
    // 2,000.00 income and 1,710.00 expenses is exactly 14.5%
    expect(getSavingsRate(200_000, 171_000)).toBe(14)
  })

  it('rounds just under a whole percent down', () => {
    expect(getSavingsRate(10_000, 8_501)).toBe(14)
    expect(getSavingsRate(10_000, 8_500)).toBe(15)
  })

  it('rounds a negative rate down, away from zero', () => {
    // Expenses 2,290.00 against 2,000.00 income is exactly -14.5%
    expect(getSavingsRate(200_000, 229_000)).toBe(-15)
    expect(getSavingsRate(10_000, 11_401)).toBe(-15)
  })

  it('has no rate without income', () => {
    expect(getSavingsRate(0, 5_000)).toBeNull()
  })
})
