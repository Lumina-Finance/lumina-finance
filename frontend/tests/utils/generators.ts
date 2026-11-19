/**
 * Shared fast-check generators for the property tests of money, dates and rates, so two areas
 * testing the same kind of value draw it the same way
 *
 * The bounds are written out here rather than read from the app, so a bound that drifts in the code
 * fails a property instead of moving with it
 */
import fc from 'fast-check'

// One decimal place more than any seeded currency uses, so a currency added later stays covered
export const MAX_CURRENCY_EXPONENT = 4

export const currencyExponents = fc.integer({ min: 0, max: MAX_CURRENCY_EXPONENT })

// The frontend holds amounts as numbers, so only whole amounts up to the largest exact integer exist here
export const signedMinorUnits = fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER })
export const nonNegativeMinorUnits = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER })

// Signed 64-bit, the range a stored amount in minor units can hold. Imports read amounts as bigints, so
// they reach past the numbers above to the ends of what the backend stores
export const INT64_MIN = -(2n ** 63n)
export const INT64_MAX = 2n ** 63n - 1n

// How far inside each end of the stored range the end-favouring draws reach
const RANGE_END_SPREAD = 2n

/**
 * Draws an amount anywhere in the stored range, with its two ends drawn on purpose, since a bound one
 * step off holds for every amount but the last
 */
export const storableMinorUnits = fc.oneof(
  fc.bigInt({ min: INT64_MIN, max: INT64_MAX }),
  fc.bigInt({ min: INT64_MAX - RANGE_END_SPREAD, max: INT64_MAX }),
  fc.bigInt({ min: INT64_MIN, max: INT64_MIN + RANGE_END_SPREAD }),
)

/**
 * Writes an amount in minor units as the decimal text an import submits, with every decimal place
 */
export function writeMinorUnits(amount: bigint, exponent: number): string {
  const sign = amount < 0n ? '-' : ''
  const digits = (amount < 0n ? -amount : amount).toString().padStart(exponent + 1, '0')
  if (exponent === 0) return `${sign}${digits}`

  return `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`
}

// The calendar the generated days come from, wide enough to cross leap years and centuries
const EARLIEST_YEAR = 1900
const LATEST_YEAR = 2100

// How far either side of a span's edge a range may fall, so a property meets both sides of it
const EDGE_SPREAD_DAYS = 3

export type CalendarDay = { year: number; month: number; day: number }

export type DateRange = { from: CalendarDay; to: CalendarDay }

export function getDaysInUtcMonth(year: number, month: number): number {
  // Day zero of the following month is the last day of this one
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Draws a real calendar day, so 30 February never appears
 */
export const calendarDays: fc.Arbitrary<CalendarDay> = fc
  .tuple(fc.integer({ min: EARLIEST_YEAR, max: LATEST_YEAR }), fc.integer({ min: 1, max: 12 }))
  .chain(([year, month]) =>
    fc.integer({ min: 1, max: getDaysInUtcMonth(year, month) }).map((day) => ({ year, month, day })),
  )

/**
 * Draws 29 February of every fourth year from 1904 to 2096, all leap, since rules stepping by
 * months or years treat that day differently
 */
export const leapDays: fc.Arbitrary<CalendarDay> = fc
  .integer({ min: 476, max: 524 })
  .map((fourYears) => ({ year: fourYears * 4, month: 2, day: 29 }))

/**
 * Draws one of the last four days of a month, where a rule clamping a day to the month's length
 * changes what it returns
 */
export const lateMonthDays: fc.Arbitrary<CalendarDay> = fc
  .tuple(
    fc.integer({ min: EARLIEST_YEAR, max: LATEST_YEAR }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 0, max: 3 }),
  )
  .map(([year, month, daysBeforeEnd]) => ({ year, month, day: getDaysInUtcMonth(year, month) - daysBeforeEnd }))

/**
 * Writes a calendar day as "YYYY-MM-DD"
 */
export function toYmd({ year, month, day }: CalendarDay): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Returns the calendar day the given number of days later, or earlier for a negative count
 */
export function shiftCalendarDays({ year, month, day }: CalendarDay, days: number): CalendarDay {
  const shifted = new Date(Date.UTC(year, month - 1, day + days))

  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() }
}

/**
 * Draws a range, first day then last, with the first day on or before the last
 */
export const dateRanges: fc.Arbitrary<DateRange> = fc.tuple(calendarDays, calendarDays).map(([one, other]) => {
  const [from, to] = toYmd(one) <= toYmd(other) ? [one, other] : [other, one]

  return { from, to }
})

/**
 * Draws a range whose last day falls within a few days of the given number of years after its first,
 * so a property about a span meets both sides of its edge
 */
export function dateRangesNearSpan(years: number): fc.Arbitrary<DateRange> {
  // A range starting on 29 February is the case a span's edge treats differently, so it is drawn on purpose
  return fc
    .tuple(fc.oneof(calendarDays, leapDays), fc.integer({ min: -EDGE_SPREAD_DAYS, max: EDGE_SPREAD_DAYS }))
    .map(([from, spread]) => {
      const edge = new Date(Date.UTC(from.year + years, from.month - 1, from.day + spread))

      return { from, to: { year: edge.getUTCFullYear(), month: edge.getUTCMonth() + 1, day: edge.getUTCDate() } }
    })
}

export type TypedAmount = { minorUnits: number; text: string }

// How many zeros a person may type before an amount or past its last decimal place
const MAX_EXTRA_ZEROS = 2

/**
 * Draws text a person may type for an amount in minor units in a currency with the given decimal
 * places, with leading zeros, and its decimal places cut back to the last nonzero one or padded with
 * zeros past the currency's, all of which spell the same amount
 */
export function typedSpellings(minorUnits: number, exponent: number): fc.Arbitrary<string> {
  return fc.tuple(fc.nat(MAX_EXTRA_ZEROS), fc.nat(exponent + MAX_EXTRA_ZEROS)).map(([leadingZeros, decimalPlaces]) => {
    const digits = String(minorUnits).padStart(exponent + 1, '0')
    const pointAt = digits.length - exponent
    const fraction = digits.slice(pointAt).replace(/0+$/, '').padEnd(decimalPlaces, '0')

    return `${'0'.repeat(leadingZeros)}${digits.slice(0, pointAt)}${fraction ? `.${fraction}` : ''}`
  })
}

/**
 * Draws a non-negative amount in minor units with text a person may type for it
 */
export function typedAmounts(exponent: number): fc.Arbitrary<TypedAmount> {
  return nonNegativeMinorUnits.chain((minorUnits) =>
    typedSpellings(minorUnits, exponent).map((text) => ({ minorUnits, text })),
  )
}
