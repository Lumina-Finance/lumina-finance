/**
 * Guards how a savings rate is written. A rate below zero, spending more than was earned, shows a
 * true minus like every other negative, where it showed a hyphen. A positive rate stays unsigned
 */
import { describe, expect, it } from 'vitest'
import { formatSavingsRateValue } from '@/pages/insights/utils/money'

describe('savings rate value', () => {
  it.each([
    [-20, '−20%'],
    [20, '20%'],
    [0, '0%'],
    [null, 'N/A'],
  ])('writes a rate of %s as %s', (rate, expected) => {
    expect(formatSavingsRateValue(rate)).toBe(expected)
  })
})
