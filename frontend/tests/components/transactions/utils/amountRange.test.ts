/**
 * Tests the amount filter's bounds check, which keeps a minimum above the maximum from being
 * applied and coming back as an empty list with no reason given, and the rules that keep the bounds
 * off screen, and leave the applied ones alone, until the decimal places they are counted in are known.
 * A bound larger than the filter takes is refused with a message naming the largest amount it takes
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Currency } from '@/api/currency'
import {
  buildAmountFilterPatch,
  describeAmountTooLarge,
  findAmountRangeDraft,
  findTooLargeAmountBounds,
  isAmountRangeCrossed,
  isAmountRangeLocked,
  isAppliedRangeWaitingOnCurrency,
} from '@/components/transactions/utils/amountRange'
import { currencyExponents, typedAmounts, typedSpellings } from '@tests/utils/generators'

const CENTS = 2
const WHOLE_UNITS = 0

const currencies: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese Yen', symbol: '¥', minor_unit_exponent: 0 },
]

// What the currency query holds until it resolves
const NO_CURRENCIES: Currency[] = []

/**
 * Draws two typed bounds in a currency, sometimes for the same amount or for amounts one minor unit
 * apart, so the edge between in order and crossed is met as often as ranges far from it
 */
const typedBounds = currencyExponents.chain((exponent) => {
  const amounts = typedAmounts(exponent)
  const respell = (minorUnits: number) => typedSpellings(minorUnits, exponent).map((text) => ({ minorUnits, text }))
  const pairs = fc.oneof(
    fc.tuple(amounts, amounts),
    amounts.chain((min) => fc.tuple(fc.constant(min), respell(min.minorUnits))),
    amounts.chain((min) => fc.tuple(fc.constant(min), respell(Math.max(min.minorUnits - 1, 0)))),
  )

  return pairs.map(([min, max]) => ({ exponent, min, max }))
})

// Text holding a digit can still name no amount when it carries a mark a money field doesn't take
const unreadableBounds = fc.oneof(
  fc.string().filter((text) => !/\d/.test(text)),
  typedAmounts(CENTS).map(({ text }) => `1,${text}`),
  typedAmounts(CENTS).map(({ text }) => `${text}.5.`),
)

describe('bounds that exclude each other', () => {
  it('reports a range crossed exactly when the minimum is a larger amount than the maximum, however each is typed', () => {
    fc.assert(
      fc.property(typedBounds, ({ exponent, min, max }) => {
        expect(isAmountRangeCrossed({ min: min.text, max: max.text }, exponent)).toBe(min.minorUnits > max.minorUnits)
      }),
    )
  })

  it('allows bounds naming the same amount', () => {
    expect(isAmountRangeCrossed({ min: '10.00', max: '10.00' }, CENTS)).toBe(false)
  })

  it('rounds each bound the way applying it would', () => {
    expect(isAmountRangeCrossed({ min: '10.006', max: '10.01' }, CENTS)).toBe(false)
    expect(isAmountRangeCrossed({ min: '10.006', max: '10.004' }, CENTS)).toBe(true)
  })

  it('never reports a range crossed while either bound names no amount', () => {
    // The other bound is usually a real amount, since only then would reading the empty one as zero cross
    const ranges = currencyExponents.chain((exponent) =>
      fc.record({
        exponent: fc.constant(exponent),
        unreadable: unreadableBounds,
        other: fc.oneof(
          { weight: 4, arbitrary: typedAmounts(exponent).map(({ text }) => text) },
          { weight: 1, arbitrary: fc.string() },
        ),
        isMinUnreadable: fc.boolean(),
      }),
    )

    fc.assert(
      fc.property(ranges, ({ exponent, unreadable, other, isMinUnreadable }) => {
        const amount = isMinUnreadable ? { min: unreadable, max: other } : { min: other, max: unreadable }

        expect(isAmountRangeCrossed(amount, exponent)).toBe(false)
      }),
    )
  })

  it('leaves a range of 10 to blank uncrossed', () => {
    expect(isAmountRangeCrossed({ min: '10', max: '' }, CENTS)).toBe(false)
  })
})

describe('bounds past the largest amount the filter sends exactly', () => {
  // Fifteen digits of minor units is 9999999999999.99 in a currency with two decimal places
  it('reports a bound exactly when it is one minor unit past the largest amount, in a currency of any decimal places', () => {
    expect(findTooLargeAmountBounds({ min: '9999999999999.99', max: '10000000000000.00' }, CENTS)).toStrictEqual({
      min: false,
      max: true,
    })
    expect(findTooLargeAmountBounds({ min: '999999999999999', max: '1000000000000000' }, WHOLE_UNITS)).toStrictEqual({
      min: false,
      max: true,
    })
  })

  it('counts a dropped digit that rounds the amount up', () => {
    expect(findTooLargeAmountBounds({ min: '9999999999999.994', max: '9999999999999.995' }, CENTS)).toStrictEqual({
      min: false,
      max: true,
    })
  })

  it('reports a figure too long for a number to hold, which a conversion would have dropped as no amount', () => {
    expect(findTooLargeAmountBounds({ min: '9'.repeat(400), max: `${'9'.repeat(400)}.99` }, CENTS)).toStrictEqual({
      min: true,
      max: true,
    })
  })

  it('leaves a blank bound, text naming no amount and any amount in range alone', () => {
    expect(findTooLargeAmountBounds({ min: '', max: 'abc' }, CENTS)).toStrictEqual({ min: false, max: false })
    expect(findTooLargeAmountBounds({ min: '0', max: '1,000.00' }, CENTS)).toStrictEqual({ min: false, max: false })
    expect(findTooLargeAmountBounds({ min: '10.00', max: '1000000000.00' }, CENTS)).toStrictEqual({
      min: false,
      max: false,
    })
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
    expect(
      findAmountRangeDraft({ min_amount: 1000, max_amount: 5000, amount_currency: 'JPY' }, currencies),
    ).toStrictEqual({
      min: '1000',
      max: '5000',
    })
    expect(
      findAmountRangeDraft({ min_amount: 1000, max_amount: 5000, amount_currency: 'CAD' }, currencies),
    ).toStrictEqual({
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
    expect(
      buildAmountFilterPatch({
        amount: { min: '', max: '' },
        amountCurrency: 'USD',
        exponent: CENTS,
        isLocked: true,
        filters: { min_amount: 1000, max_amount: 5000, amount_currency: 'CAD' },
      }),
    ).toStrictEqual({ min_amount: 1000, max_amount: 5000, amount_currency: 'CAD' })
  })

  it('refuses to convert text left in a locked field at the fallback scale', () => {
    expect(
      buildAmountFilterPatch({
        amount: { min: '7', max: '' },
        amountCurrency: 'JPY',
        exponent: CENTS,
        isLocked: true,
        filters: { min_amount: 1000, max_amount: 5000, amount_currency: 'JPY' },
      }),
    ).toStrictEqual({ min_amount: 1000, max_amount: 5000, amount_currency: 'JPY' })
  })
})

describe('the range once its currency is known', () => {
  it('commits what the fields hold', () => {
    expect(
      buildAmountFilterPatch({
        amount: { min: '25', max: '80' },
        amountCurrency: 'JPY',
        exponent: WHOLE_UNITS,
        isLocked: false,
        filters: { min_amount: 1000, max_amount: 5000, amount_currency: 'CAD' },
      }),
    ).toStrictEqual({ min_amount: 25, max_amount: 80, amount_currency: 'JPY' })
  })

  it('keeps a bound of zero rather than dropping the range', () => {
    expect(
      buildAmountFilterPatch({
        amount: { min: '0', max: '' },
        amountCurrency: 'CAD',
        exponent: CENTS,
        isLocked: false,
        filters: {},
      }),
    ).toStrictEqual({ min_amount: 0, max_amount: undefined, amount_currency: 'CAD' })
  })

  it('drops the currency along with the bounds when both are cleared', () => {
    expect(
      buildAmountFilterPatch({
        amount: { min: '', max: '' },
        amountCurrency: 'JPY',
        exponent: WHOLE_UNITS,
        isLocked: false,
        filters: { min_amount: 1000, max_amount: 5000, amount_currency: 'JPY' },
      }),
    ).toStrictEqual({ min_amount: undefined, max_amount: undefined, amount_currency: undefined })
  })
})

describe('describeAmountTooLarge', () => {
  it('names the largest amount the filter takes at the decimal places of the currency it matches in', () => {
    expect(describeAmountTooLarge('CAD', currencies)).toMatch(/^Enter an amount up to \D*9,999,999,999,999\.99$/)
    expect(describeAmountTooLarge('JPY', currencies)).toMatch(/^Enter an amount up to \D*999,999,999,999,999$/)
  })
})
