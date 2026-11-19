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

// The calendar the generated days come from, wide enough to cross leap years and centuries
const EARLIEST_YEAR = 1900
const LATEST_YEAR = 2100

// How far either side of a span's edge a range may fall, so a property meets both sides of it
const EDGE_SPREAD_DAYS = 3

export type CalendarDay = { year: number; month: number; day: number }

export type DateRange = { from: CalendarDay; to: CalendarDay }

function getDaysInUtcMonth(year: number, month: number): number {
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
 * Writes a calendar day as "YYYY-MM-DD"
 */
export function toYmd({ year, month, day }: CalendarDay): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
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
  // A range starting on 29 February is the case a span's edge treats differently, so it is drawn on purpose.
  // The years are every fourth one from 1904 to 2096, all leap
  const leapDays = fc.integer({ min: 476, max: 524 }).map((fourYears) => ({ year: fourYears * 4, month: 2, day: 29 }))

  return fc
    .tuple(fc.oneof(calendarDays, leapDays), fc.integer({ min: -EDGE_SPREAD_DAYS, max: EDGE_SPREAD_DAYS }))
    .map(([from, spread]) => {
      const edge = new Date(Date.UTC(from.year + years, from.month - 1, from.day + spread))

      return { from, to: { year: edge.getUTCFullYear(), month: edge.getUTCMonth() + 1, day: edge.getUTCDate() } }
    })
}
