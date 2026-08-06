/**
 * Tests the segmented date logic so partial edits clamp to real dates instead of blanking the field
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_SEGMENTS,
  formatIsoDate,
  parseIsoDate,
  setSegmentDigits,
  shouldAdvanceSegment,
  stepSegment,
} from '@/components/date-field/dateSegments'

const FIXED_TODAY = new Date(2026, 6, 8)

describe('date segment editing', () => {
  it('clamps the day to the month when switching a 31 day month to February', () => {
    const afterMonthEdit = setSegmentDigits(parseIsoDate('2026-01-31'), 'month', '02')

    expect(afterMonthEdit).toEqual({ year: '2026', month: '02', day: '28' })
    expect(formatIsoDate(afterMonthEdit)).toBe('2026-02-28')
  })

  it('clamps a day typed past the current month maximum', () => {
    const afterDayEdit = setSegmentDigits(parseIsoDate('2026-04-30'), 'day', '31')

    expect(afterDayEdit.day).toBe('30')
  })

  it('keeps February 29 in a leap year and drops it otherwise', () => {
    expect(formatIsoDate(setSegmentDigits({ year: '2024', month: '02', day: '' }, 'day', '29'))).toBe('2024-02-29')
    expect(setSegmentDigits({ year: '2025', month: '02', day: '' }, 'day', '29').day).toBe('28')
  })

  it('allows February 29 while the year is unknown, then clamps once the year is set', () => {
    const withFebEnd = setSegmentDigits({ year: '', month: '02', day: '29' }, 'month', '02')
    expect(withFebEnd.day).toBe('29')

    expect(setSegmentDigits(withFebEnd, 'year', '2025').day).toBe('28')
  })

  it('never emits an ISO string until every segment is complete', () => {
    expect(formatIsoDate(setSegmentDigits(EMPTY_SEGMENTS, 'year', '2026'))).toBe('')
  })

  it('clamps out of range months into January to December', () => {
    expect(setSegmentDigits(EMPTY_SEGMENTS, 'month', '13').month).toBe('12')
    expect(setSegmentDigits(EMPTY_SEGMENTS, 'month', '00').month).toBe('01')
  })

  it('advances focus once a segment can no longer grow', () => {
    expect(shouldAdvanceSegment('month', '2')).toBe(true)
    expect(shouldAdvanceSegment('month', '1')).toBe(false)
    expect(shouldAdvanceSegment('day', '4')).toBe(true)
    expect(shouldAdvanceSegment('day', '3')).toBe(false)
    expect(shouldAdvanceSegment('year', '2026')).toBe(true)
    expect(shouldAdvanceSegment('year', '202')).toBe(false)
  })

  it('wraps month and day on arrow steps and clamps the day when the month changes', () => {
    expect(stepSegment({ year: '2026', month: '12', day: '15' }, 'month', 1, FIXED_TODAY).month).toBe('01')
    expect(stepSegment({ year: '2026', month: '01', day: '15' }, 'month', -1, FIXED_TODAY).month).toBe('12')
    expect(stepSegment({ year: '2026', month: '01', day: '31' }, 'month', 1, FIXED_TODAY).day).toBe('28')
    expect(stepSegment({ year: '2026', month: '02', day: '28' }, 'day', 1, FIXED_TODAY).day).toBe('01')
  })

  it('seeds an empty segment from today on the first arrow press', () => {
    expect(stepSegment(EMPTY_SEGMENTS, 'month', 1, FIXED_TODAY).month).toBe('07')
    expect(stepSegment(EMPTY_SEGMENTS, 'year', 1, FIXED_TODAY).year).toBe('2026')
    expect(stepSegment(EMPTY_SEGMENTS, 'day', 1, FIXED_TODAY).day).toBe('08')
  })
})
