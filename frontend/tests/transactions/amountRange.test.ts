/**
 * Tests the amount filter's bounds check, which keeps a minimum above the maximum from being
 * applied and coming back as an empty list with no reason given, and the rules that keep the bounds
 * off screen and out of the applied filters until the decimal places they are counted in are known
 */
import { describe, expect, it } from 'vitest'
import type { Currency } from '@/api/currency'
import {
  buildAmountFilterPatch,
  findAmountRangeDraft,
  isAmountRangeCrossed,
  isAmountRangeLocked,
} from '@/pages/transactions/utils/amountRange'

const CENTS = 2
const WHOLE_UNITS = 0

const currencies: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese Yen', symbol: '¥', minor_unit_exponent: 0 },
]

// What the currency query holds until it resolves
const NO_CURRENCIES: Currency[] = []

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

describe('the range while the currency table is missing', () => {
  it('locks until the matched currency is in the table', () => {
    expect(isAmountRangeLocked(NO_CURRENCIES, 'JPY')).toBe(true)
    expect(isAmountRangeLocked(currencies, 'JPY')).toBe(false)
    expect(isAmountRangeLocked(currencies, 'KWD')).toBe(true)
  })

  it('shows nothing rather than an amount scaled by the two-place fallback', () => {
    expect(findAmountRangeDraft({ min_amount: 1000, amount_currency: 'JPY' }, NO_CURRENCIES)).toBeNull()
    expect(findAmountRangeDraft({ min_amount: 1000, amount_currency: 'JPY' }, currencies)).toEqual({
      min: '1000',
      max: '',
    })
    expect(findAmountRangeDraft({ min_amount: 1000, amount_currency: 'CAD' }, currencies)).toEqual({
      min: '10.00',
      max: '',
    })
  })

  it('leaves both bounds blank when none is applied', () => {
    expect(findAmountRangeDraft({ amount_currency: 'CAD' }, currencies)).toEqual({ min: '', max: '' })
  })

  it('keeps the applied bounds when the fields are locked and therefore blank', () => {
    const applied = { min_amount: 1000, max_amount: 5000, amount_currency: 'JPY' }

    expect(buildAmountFilterPatch({
      amount: { min: '', max: '' },
      amountCurrency: 'JPY',
      exponent: CENTS,
      isLocked: true,
      filters: applied,
    })).toEqual(applied)
  })

  it('commits what the fields hold once they are editable', () => {
    expect(buildAmountFilterPatch({
      amount: { min: '1000', max: '' },
      amountCurrency: 'JPY',
      exponent: WHOLE_UNITS,
      isLocked: false,
      filters: { min_amount: 1000, amount_currency: 'JPY' },
    })).toEqual({ min_amount: 1000, max_amount: undefined, amount_currency: 'JPY' })
  })

  it('drops the currency along with the bounds when both are cleared', () => {
    expect(buildAmountFilterPatch({
      amount: { min: '', max: '' },
      amountCurrency: 'JPY',
      exponent: WHOLE_UNITS,
      isLocked: false,
      filters: { min_amount: 1000, amount_currency: 'JPY' },
    })).toEqual({ min_amount: undefined, max_amount: undefined, amount_currency: undefined })
  })
})
