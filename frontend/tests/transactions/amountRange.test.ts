/**
 * Tests the amount filter's bounds check, which keeps a minimum above the maximum from being
 * applied and coming back as an empty list with no reason given, and the rules that keep the bounds
 * off screen, and leave the applied ones alone, until the decimal places they are counted in are known
 */
import { describe, expect, it } from 'vitest'
import type { Currency } from '@/api/currency'
import {
  buildAmountFilterPatch,
  findAmountRangeDraft,
  isAmountRangeCrossed,
  isAmountRangeLocked,
  isAppliedRangeWaitingOnCurrency,
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

describe('the range while its currency has no known decimal places', () => {
  it('locks the fields until the currency they edit in is in the table', () => {
    expect(isAmountRangeLocked({}, NO_CURRENCIES, 'JPY')).toBe(true)
    expect(isAmountRangeLocked({}, currencies, 'JPY')).toBe(false)
    expect(isAmountRangeLocked({}, currencies, 'KWD')).toBe(true)
    // A user whose base currency is empty names no currency for the fields to edit in
    expect(isAmountRangeLocked({}, currencies, '')).toBe(true)
  })

  it('locks the fields over an applied bound it cannot show, whatever they edit in', () => {
    const waiting = { min_amount: 1000, amount_currency: 'KWD' }

    expect(isAppliedRangeWaitingOnCurrency(waiting, currencies)).toBe(true)
    expect(isAmountRangeLocked(waiting, currencies, 'CAD')).toBe(true)
  })

  it('leaves the currency choice alone when no applied bound is waiting', () => {
    expect(isAppliedRangeWaitingOnCurrency({}, NO_CURRENCIES)).toBe(false)
    expect(isAppliedRangeWaitingOnCurrency({ amount_currency: 'JPY' }, NO_CURRENCIES)).toBe(false)
    expect(isAppliedRangeWaitingOnCurrency({ min_amount: 1000, amount_currency: 'JPY' }, currencies)).toBe(false)
  })

  it('shows nothing rather than an amount scaled by the two-place fallback', () => {
    expect(findAmountRangeDraft({ min_amount: 1000, amount_currency: 'JPY' }, NO_CURRENCIES)).toBeNull()
    expect(findAmountRangeDraft({ min_amount: 1000, max_amount: 5000, amount_currency: 'JPY' }, currencies)).toStrictEqual({
      min: '1000',
      max: '5000',
    })
    expect(findAmountRangeDraft({ min_amount: 1000, max_amount: 5000, amount_currency: 'CAD' }, currencies)).toStrictEqual({
      min: '10.00',
      max: '50.00',
    })
  })

  it('shows a bound of zero rather than reading it as no bound', () => {
    expect(findAmountRangeDraft({ min_amount: 0, amount_currency: 'CAD' }, currencies)).toStrictEqual({
      min: '0.00',
      max: '',
    })
  })

  it('has nothing to show when no currency was applied with the bounds', () => {
    expect(findAmountRangeDraft({}, currencies)).toBeNull()
    expect(findAmountRangeDraft({ amount_currency: 'CAD' }, currencies)).toStrictEqual({ min: '', max: '' })
  })

  it('keeps the applied bounds and their own currency while the fields are locked', () => {
    expect(buildAmountFilterPatch({
      amount: { min: '', max: '' },
      amountCurrency: 'USD',
      exponent: CENTS,
      isLocked: true,
      filters: { min_amount: 1000, max_amount: 5000, amount_currency: 'CAD' },
    })).toStrictEqual({ min_amount: 1000, max_amount: 5000, amount_currency: 'CAD' })
  })

  it('refuses to convert text left in a locked field at the fallback scale', () => {
    expect(buildAmountFilterPatch({
      amount: { min: '7', max: '' },
      amountCurrency: 'JPY',
      exponent: CENTS,
      isLocked: true,
      filters: { min_amount: 1000, max_amount: 5000, amount_currency: 'JPY' },
    })).toStrictEqual({ min_amount: 1000, max_amount: 5000, amount_currency: 'JPY' })
  })

})

describe('the range once its currency is known', () => {
  it('commits what the fields hold', () => {
    expect(buildAmountFilterPatch({
      amount: { min: '25', max: '80' },
      amountCurrency: 'JPY',
      exponent: WHOLE_UNITS,
      isLocked: false,
      filters: { min_amount: 1000, max_amount: 5000, amount_currency: 'CAD' },
    })).toStrictEqual({ min_amount: 25, max_amount: 80, amount_currency: 'JPY' })
  })

  it('keeps a bound of zero rather than dropping the range', () => {
    expect(buildAmountFilterPatch({
      amount: { min: '0', max: '' },
      amountCurrency: 'CAD',
      exponent: CENTS,
      isLocked: false,
      filters: {},
    })).toStrictEqual({ min_amount: 0, max_amount: undefined, amount_currency: 'CAD' })
  })

  it('drops the currency along with the bounds when both are cleared', () => {
    expect(buildAmountFilterPatch({
      amount: { min: '', max: '' },
      amountCurrency: 'JPY',
      exponent: WHOLE_UNITS,
      isLocked: false,
      filters: { min_amount: 1000, max_amount: 5000, amount_currency: 'JPY' },
    })).toStrictEqual({ min_amount: undefined, max_amount: undefined, amount_currency: undefined })
  })
})
