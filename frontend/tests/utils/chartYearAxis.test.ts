/**
 * Covers the rule the charts' month axes share: a range over two calendar years names the year on its
 * January label, and the axis keeps that label when too few labels fit
 */
import { describe, expect, it } from 'vitest'
import { crossesCalendarYear, getYearAxisLabelIndexes, getYearAxisTicks } from '@/utils/chartYearAxis'

describe('crossesCalendarYear', () => {
  it.each([
    ['2025-10-01', '2026-10-27', true],
    ['2025-01-01', '2026-12-31', true],
    ['2025-12-31', '2026-01-01', true],
    ['2026-03-01', '2026-10-27', false],
    ['2026-01-01', '2026-12-31', false],
  ])('reads %s to %s as crossing a year: %s', (fromDate, toDate, expected) => {
    expect(crossesCalendarYear(fromDate, toDate)).toBe(expected)
  })
})

describe('getYearAxisTicks', () => {
  const bars = (labels: string[], marked: number) =>
    labels.map((label, index) => ({
      label,
      key: `range ${index}`,
      marksYear: index === marked,
    }))
  const months = [
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
    'Jan 2026',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
  ]

  it('leaves the chart to thin its own labels when no bar marks the year or the width is not measured', () => {
    expect(getYearAxisTicks(bars(months, -1), 280)).toBeUndefined()
    expect(getYearAxisTicks(bars(months, 5), 0)).toBeUndefined()
  })

  it('names the bars to label by their key, evenly spaced from the January bar', () => {
    expect(getYearAxisTicks(bars(months, 5), 280)).toEqual(['range 2', 'range 5', 'range 8', 'range 11', 'range 14'])
  })

  it('returns keys of any type the axis plots by', () => {
    const dated = bars(months, 5).map((bar, index) => ({ ...bar, key: 1_000 + index }))
    expect(getYearAxisTicks(dated, 280)).toEqual([1_002, 1_005, 1_008, 1_011, 1_014])
  })

  // "Jan 5, 2026" is wider than "Jan 2026", so the labels must sit further apart in the same width
  it('spaces labels further apart when the year label is wider', () => {
    const days = months.map((label, index) => (index === 5 ? 'Jan 5, 2026' : label))
    expect(getYearAxisTicks(bars(months, 5), 220)).toEqual(['range 1', 'range 5', 'range 9', 'range 13'])
    expect(getYearAxisTicks(bars(days, 5), 220)).toEqual(['range 0', 'range 5', 'range 10'])
  })
})

describe('getYearAxisLabelIndexes', () => {
  // Recharts' thinning dropped the January label on a phone, so the year change vanished from the axis
  it('labels every stride-th bar counted from the bar that marks the year, so the steps are even', () => {
    const marksYear = Array.from({ length: 15 }, (_, index) => index === 5)
    expect(getYearAxisLabelIndexes(marksYear, 3)).toEqual([2, 5, 8, 11, 14])
  })

  it('keeps every bar that marks the year and drops a label closer to one than the stride', () => {
    const marksYear = Array.from({ length: 15 }, (_, index) => index === 5 || index === 12)
    expect(getYearAxisLabelIndexes(marksYear, 5)).toEqual([0, 5, 12])
  })

  it('labels every bar when they all fit', () => {
    expect(getYearAxisLabelIndexes([false, true, false], 1)).toEqual([0, 1, 2])
  })
})
