/**
 * Tests the window every date must sit in and the longest span a range may cover, so a date picked or
 * typed before 1 January 1900 or more than ten years ahead, or a range of over 20 years, is refused
 * with the reason a field says
 */
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_DATE_FORMAT, setDateFormat } from '@/utils/dateFormat'
import {
  getDateWindowError,
  getLatestAllowedYmd,
  getOverviewRangeSpanError,
  getRangeSpanError,
} from '@/utils/dateWindow'

// A fixed today, so the window's far edge is the same on every day the suite runs
const TODAY = '2026-06-10'

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
  })

  it('leaves ends not yet whole alone', () => {
    expect(getRangeSpanError('2010-01-01', '')).toBeNull()
    expect(getRangeSpanError('', '2030-01-01')).toBeNull()
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

  it('reads an end with no start as running from the first of the month', () => {
    expect(getOverviewRangeSpanError(undefined, '2026-06-20', today)).toBeNull()
  })

  it('refuses two dates exactly 20 years apart and takes one day less', () => {
    expect(getOverviewRangeSpanError('2000-03-01', '2020-03-01', today)).toBe('Can cover at most 20 years')
    expect(getOverviewRangeSpanError('2000-03-01', '2020-02-29', today)).toBeNull()
  })
})
