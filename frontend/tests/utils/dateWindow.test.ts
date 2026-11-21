/**
 * Tests the window every date must sit in and the longest span a range may cover, so a date picked or
 * typed before 1 January 1900 or more than ten years ahead, or a range of over 20 years, is refused
 * with the reason a field says
 */
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_DATE_FORMAT, setDateFormat } from '@/utils/dateFormat'
import {
  getDateWindowError,
  getLatestAllowedYmd,
  getOverviewRange,
  getOverviewRangeSpanError,
  getRangeSpanError,
} from '@/utils/dateWindow'
import { calendarDays, dateRanges, dateRangesNearSpan, toYmd, type CalendarDay } from '@tests/utils/generators'

// A fixed today, so the window's far edge is the same on every day the suite runs
const TODAY = '2026-06-10'

/**
 * Says whether the last day is 20 calendar years or more after the first, a 29 February first day
 * having its anniversary on 28 February in a year without a 29th. The server's own property test
 * checks the same rule, so the two refuse the same ranges
 */
function coversTwentyYearsOrMore(from: CalendarDay, to: CalendarDay): boolean {
  const year = from.year + 20
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const anniversaryDay = from.month === 2 && from.day === 29 && !isLeapYear ? 28 : from.day
  const asNumber = (year: number, month: number, day: number) => (year * 100 + month) * 100 + day

  return asNumber(to.year, to.month, to.day) >= asNumber(from.year + 20, from.month, anniversaryDay)
}

afterEach(() => setDateFormat(DEFAULT_DATE_FORMAT))

describe('getLatestAllowedYmd', () => {
  it('lands ten years after today, moving 29 February to 28 February where the year has none', () => {
    expect(getLatestAllowedYmd(TODAY)).toBe('2036-06-10')
    expect(getLatestAllowedYmd('2028-02-29')).toBe('2038-02-28')
    expect(getLatestAllowedYmd('2020-02-29')).toBe('2030-02-28')
  })
})

describe('getDateWindowError', () => {
  it('accepts both edges of the window and the days between', () => {
    expect(getDateWindowError('1900-01-01', TODAY)).toBeNull()
    expect(getDateWindowError('2026-03-15', TODAY)).toBeNull()
    expect(getDateWindowError('2036-06-10', TODAY)).toBeNull()
  })

  it('refuses the day before the window with the earliest date in the user date format, kept on one line', () => {
    expect(getDateWindowError('1899-12-31', TODAY)).toBe('Must be on or after Jan 1, 1900')
    expect(getDateWindowError('0001-01-01', TODAY)).toBe('Must be on or after Jan 1, 1900')

    setDateFormat('iso')
    expect(getDateWindowError('1850-01-01', TODAY)).toBe('Must be on or after 1900-01-01')
  })

  it('refuses the day after the window and a date far past it', () => {
    expect(getDateWindowError('2036-06-11', TODAY)).toBe('Must be within ten years of today')
    expect(getDateWindowError('9999-12-31', TODAY)).toBe('Must be within ten years of today')
  })

  it('refuses the day after the window when today is 29 February', () => {
    expect(getDateWindowError('2038-02-28', '2028-02-29')).toBeNull()
    expect(getDateWindowError('2038-03-01', '2028-02-29')).toBe('Must be within ten years of today')
  })

  it('leaves a date not yet whole to the field’s own checks', () => {
    expect(getDateWindowError('', TODAY)).toBeNull()
    expect(getDateWindowError('2026-0', TODAY)).toBeNull()
  })
})

describe('getRangeSpanError', () => {
  it('accepts a range one day short of 20 years and refuses one of exactly 20 years', () => {
    expect(getRangeSpanError('2010-01-01', '2029-12-31')).toBeNull()
    expect(getRangeSpanError('2010-01-01', '2030-01-01')).toBe('Can cover at most 20 years')
  })

  it('counts a range starting on 29 February in whole years', () => {
    expect(getRangeSpanError('2016-02-29', '2036-02-28')).toBeNull()
    expect(getRangeSpanError('2016-02-29', '2036-02-29')).toBe('Can cover at most 20 years')
    // 2100 is not a leap year, so the anniversary of 29 February 2080 is 28 February
    expect(getRangeSpanError('2080-02-29', '2100-02-27')).toBeNull()
    expect(getRangeSpanError('2080-02-29', '2100-02-28')).toBe('Can cover at most 20 years')
  })

  it('leaves ends not yet whole alone', () => {
    expect(getRangeSpanError('2010-01-01', '')).toBeNull()
    expect(getRangeSpanError('', '2030-01-01')).toBeNull()
  })

  it('refuses a range exactly when its last day is 20 years or more after its first, as the server does', () => {
    fc.assert(
      fc.property(fc.oneof(dateRanges, dateRangesNearSpan(20)), ({ from, to }) => {
        const error = getRangeSpanError(toYmd(from), toYmd(to))

        expect(error).toBe(coversTwentyYearsOrMore(from, to) ? 'Can cover at most 20 years' : null)
      }),
    )
  })
})

describe('getOverviewRange', () => {
  const today = '2026-06-30'

  it('runs a filter with no dates from the first of this month to today', () => {
    expect(getOverviewRange(undefined, undefined, today)).toEqual({ from: '2026-06-01', to: '2026-06-30' })
    expect(getOverviewRange('', '', today)).toEqual({ from: '2026-06-01', to: '2026-06-30' })
  })

  it('keeps both dates a filter sets, and fills only the end it leaves out', () => {
    expect(getOverviewRange('2026-02-03', '2026-04-05', today)).toEqual({ from: '2026-02-03', to: '2026-04-05' })
    expect(getOverviewRange('2026-02-03', undefined, today)).toEqual({ from: '2026-02-03', to: today })
    expect(getOverviewRange(undefined, '2026-06-12', today)).toEqual({ from: '2026-06-01', to: '2026-06-12' })
  })

  it('starts a filter with only an end before this month on the first of the month that end falls in', () => {
    expect(getOverviewRange(undefined, '2025-01-31', today)).toEqual({ from: '2025-01-01', to: '2025-01-31' })
    expect(getOverviewRange(undefined, '2026-05-31', today)).toEqual({ from: '2026-05-01', to: '2026-05-31' })
    expect(getOverviewRange(undefined, '2026-06-01', today)).toEqual({ from: '2026-06-01', to: '2026-06-01' })
  })

  it('leaves a filter with only an end after this month starting on the first of this month', () => {
    expect(getOverviewRange(undefined, '2027-03-15', today)).toEqual({ from: '2026-06-01', to: '2027-03-15' })
  })

  it('ends a filter with only a start after today on that day, so the range never runs backwards', () => {
    expect(getOverviewRange('2026-07-01', undefined, today)).toEqual({ from: '2026-07-01', to: '2026-07-01' })
    expect(getOverviewRange('2026-06-30', undefined, today)).toEqual({ from: '2026-06-30', to: today })
  })

  it('never returns an end before the start for any dates a filter can hold', () => {
    fc.assert(
      fc.property(
        fc.option(calendarDays, { nil: undefined }),
        fc.option(calendarDays, { nil: undefined }),
        calendarDays,
        (from, to, todayDay) => {
          const range = getOverviewRange(from && toYmd(from), to && toYmd(to), toYmd(todayDay))

          // A filter that crosses its own ends is refused where it is typed, so only an uncrossed one is asked of
          if (from && to && toYmd(from) > toYmd(to)) return
          expect(range.from <= range.to).toBe(true)
          if (from) expect(range.from).toBe(toYmd(from))
          if (to) expect(range.to).toBe(toYmd(to))
        },
      ),
    )
  })
})

describe('getOverviewRangeSpanError', () => {
  // Today is a given day, so a summary asking for no end runs to it and one asking for no start runs
  // from the first of its month
  const today = '2026-06-30'

  it('reads a start with no end as running to today', () => {
    expect(getOverviewRangeSpanError('2006-07-01', undefined, today)).toBeNull()
    expect(getOverviewRangeSpanError('2006-06-30', '', today)).toBe('Can cover at most 20 years')
    expect(getOverviewRangeSpanError('2000-01-01', '', today)).toBe('Can cover at most 20 years')
  })

  it('reads an end with no start as running from the first of the month it falls in', () => {
    expect(getOverviewRangeSpanError(undefined, '2026-06-20', today)).toBeNull()
    expect(getOverviewRangeSpanError(undefined, '2025-01-31', today)).toBeNull()
  })

  it('refuses two dates exactly 20 years apart and takes one day less', () => {
    expect(getOverviewRangeSpanError('2000-03-01', '2020-03-01', today)).toBe('Can cover at most 20 years')
    expect(getOverviewRangeSpanError('2000-03-01', '2020-02-29', today)).toBeNull()
  })
})
