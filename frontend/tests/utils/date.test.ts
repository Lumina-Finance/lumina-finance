/**
 * Tests the shared date layer, covering the zone guard that keeps an unrecognized profile setting
 * from unmounting the app and the calendar arithmetic every view derives its ranges from
 */
import { describe, expect, it } from 'vitest'
import {
  DATE_FORMATS,
  addDays,
  addMonths,
  formatDate,
  formatYmd,
  getIsoWeek,
  getStartOfWeek,
  getTodayDate,
  getTodayYmd,
  getWeekdayIndex,
  parseYmd,
  resolveTimeZone,
} from '@/utils/date'

// The suite runs in whatever zone the machine is set to, so expectations about the fallback are
// written against the zone the browser reports rather than a fixed name
const BROWSER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

// Late evening in Toronto on 30 June, already 1 July in UTC, so a zone mix-up shows up as a
// different day and a different month
const LATE_JUNE_EVENING = new Date('2026-07-01T02:00:00Z')

describe('resolveTimeZone', () => {
  it('keeps a zone the browser recognizes', () => {
    expect(resolveTimeZone('America/Toronto')).toBe('America/Toronto')
  })

  it('falls back to the browser zone for an unrecognized zone', () => {
    expect(resolveTimeZone('Not/AZone')).toBe(BROWSER_TIME_ZONE)
  })

  it('falls back to the browser zone when no zone is stored', () => {
    expect(resolveTimeZone(undefined)).toBe(BROWSER_TIME_ZONE)
    expect(resolveTimeZone(null)).toBe(BROWSER_TIME_ZONE)
    expect(resolveTimeZone('')).toBe(BROWSER_TIME_ZONE)
  })
})

describe('today in a given zone', () => {
  it('reads the calendar day from the zone rather than the instant', () => {
    expect(getTodayYmd('UTC', LATE_JUNE_EVENING)).toBe('2026-07-01')
    expect(getTodayYmd('America/Toronto', LATE_JUNE_EVENING)).toBe('2026-06-30')
  })

  it('degrades to the browser zone instead of throwing on an unrecognized zone', () => {
    expect(getTodayYmd('Not/AZone', LATE_JUNE_EVENING)).toBe(
      getTodayYmd(BROWSER_TIME_ZONE, LATE_JUNE_EVENING),
    )
  })

  it('expresses the zone day on the browser calendar so local arithmetic lands on it', () => {
    const today = getTodayDate('America/Toronto', LATE_JUNE_EVENING)

    expect([today.getFullYear(), today.getMonth() + 1, today.getDate()]).toEqual([2026, 6, 30])
  })
})

describe('formatDate', () => {
  it('renders each format in the product locale', () => {
    const june1 = new Date(2026, 5, 1)

    expect(formatDate(june1, DATE_FORMATS.month)).toBe('Jun')
    expect(formatDate(june1, DATE_FORMATS.monthDay)).toBe('Jun 1')
    expect(formatDate(june1, DATE_FORMATS.monthYear)).toBe('Jun 2026')
    expect(formatDate(june1, DATE_FORMATS.monthDayYear)).toBe('Jun 1, 2026')
    expect(formatDate(june1, DATE_FORMATS.longMonthYear)).toBe('June 2026')
    expect(formatDate(june1, DATE_FORMATS.longDate)).toBe('June 1, 2026')
  })

  it('reads a timestamp in the zone it is given', () => {
    expect(formatDate(LATE_JUNE_EVENING, DATE_FORMATS.monthDay, 'UTC')).toBe('Jul 1')
    expect(formatDate(LATE_JUNE_EVENING, DATE_FORMATS.monthDay, 'America/Toronto')).toBe('Jun 30')
  })

  it('degrades to the browser zone instead of throwing on an unrecognized zone', () => {
    expect(formatDate(LATE_JUNE_EVENING, DATE_FORMATS.monthDay, 'Not/AZone')).toBe(
      formatDate(LATE_JUNE_EVENING, DATE_FORMATS.monthDay, BROWSER_TIME_ZONE),
    )
  })
})

describe('YYYY-MM-DD strings', () => {
  it('writes and reads back the same calendar day', () => {
    expect(formatYmd(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(formatYmd(parseYmd('2026-01-05')!)).toBe('2026-01-05')
  })

  it('returns null for a string that names no date', () => {
    expect(parseYmd('not-a-date')).toBeNull()
  })

  it('refuses a day the calendar does not have instead of rolling it forward', () => {
    expect(parseYmd('2026-02-31')).toBeNull()
    expect(parseYmd('2025-02-29')).toBeNull()
    expect(parseYmd('2026-04-31')).toBeNull()
    expect(parseYmd('2026-13-01')).toBeNull()
    expect(parseYmd('2026-00-10')).toBeNull()
    expect(parseYmd('2026-01-00')).toBeNull()
  })

  it('keeps the leap day of a leap year', () => {
    expect(formatYmd(parseYmd('2024-02-29')!)).toBe('2024-02-29')
  })

  it('refuses anything that is not a zero-padded date on its own', () => {
    expect(parseYmd('2026-1-5')).toBeNull()
    expect(parseYmd('2026-01-05T00:00:00Z')).toBeNull()
    expect(parseYmd('2026/01/05')).toBeNull()
    expect(parseYmd('')).toBeNull()
  })
})

describe('calendar arithmetic', () => {
  it('counts Monday as the first day of the week', () => {
    expect(getWeekdayIndex(new Date(2026, 5, 1))).toBe(0)
    expect(getWeekdayIndex(new Date(2026, 5, 7))).toBe(6)
  })

  it('walks a Sunday back to the Monday that opened its week', () => {
    expect(formatYmd(getStartOfWeek(new Date(2026, 5, 7)))).toBe('2026-06-01')
  })

  it('steps whole days across a month boundary', () => {
    expect(formatYmd(addDays(new Date(2026, 5, 30), 1))).toBe('2026-07-01')
    expect(formatYmd(addDays(new Date(2026, 5, 1), -1))).toBe('2026-05-31')
  })

  it('clamps to the end of a shorter month instead of overflowing', () => {
    expect(formatYmd(addMonths(new Date(2026, 2, 31), -1))).toBe('2026-02-28')
  })

  it('numbers the week holding the first Thursday of the year as week one', () => {
    expect(getIsoWeek(new Date(2026, 0, 1))).toBe(1)
  })
})
