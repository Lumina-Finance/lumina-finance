/**
 * Tests the amount filter's bounds check, which keeps a minimum above the maximum from being
 * applied and coming back as an empty list with no reason given
 */
import { describe, expect, it } from 'vitest'
import { isAmountRangeCrossed } from '@/pages/transactions/utils/amountRange'

const CENTS = 2
const WHOLE_UNITS = 0

describe('bounds that exclude each other', () => {
  it('reports a minimum above the maximum', () => {
    expect(isAmountRangeCrossed({ min: '500', max: '5' }, CENTS)).toBe(true)
    expect(isAmountRangeCrossed({ min: '10.01', max: '10.00' }, CENTS)).toBe(true)
    expect(isAmountRangeCrossed({ min: '23000', max: '2300' }, WHOLE_UNITS)).toBe(true)
  })

  it('allows a range in order, including bounds naming the same amount', () => {
    expect(isAmountRangeCrossed({ min: '5', max: '500' }, CENTS)).toBe(false)
    expect(isAmountRangeCrossed({ min: '10.00', max: '10.00' }, CENTS)).toBe(false)
  })

  it('compares the stored amount rather than the typed text', () => {
    expect(isAmountRangeCrossed({ min: '9', max: '10' }, CENTS)).toBe(false)
    expect(isAmountRangeCrossed({ min: '1.5', max: '1.50' }, CENTS)).toBe(false)
  })

  it('rounds each bound the way applying it would', () => {
    expect(isAmountRangeCrossed({ min: '10.006', max: '10.01' }, CENTS)).toBe(false)
    expect(isAmountRangeCrossed({ min: '10.006', max: '10.004' }, CENTS)).toBe(true)
  })

  it('leaves a bound alone that names no amount to compare', () => {
    expect(isAmountRangeCrossed({ min: '500', max: '' }, CENTS)).toBe(false)
    expect(isAmountRangeCrossed({ min: '', max: '5' }, CENTS)).toBe(false)
    expect(isAmountRangeCrossed({ min: '500', max: '.' }, CENTS)).toBe(false)
  })
})
