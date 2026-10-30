/**
 * Covers the cash flow card's Y axis ticks stepping evenly and ending just past the tallest and lowest bars,
 * and its X axis keeping the label that carries the year when too few labels fit
 */
import { describe, expect, it } from 'vitest'
import {
  getCashFlowAxisTicks,
  getCashFlowXAxisLabelIndexes,
  getCashFlowXAxisTicks,
} from '@/pages/insights/utils/cashFlowAxis'

describe('getCashFlowXAxisTicks', () => {
  const bars = (labels: string[], marked: number) =>
    labels.map((label, index) => ({
      label,
      rangeLabel: `range ${index}`,
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
    expect(getCashFlowXAxisTicks(bars(months, -1), 280)).toBeUndefined()
    expect(getCashFlowXAxisTicks(bars(months, 5), 0)).toBeUndefined()
  })

  it('names the bars to label by their range, evenly spaced from the January bar', () => {
    expect(getCashFlowXAxisTicks(bars(months, 5), 280)).toEqual([
      'range 2',
      'range 5',
      'range 8',
      'range 11',
      'range 14',
    ])
  })

  // "Jan 5, 2026" is wider than "Jan 2026", so the labels must sit further apart in the same width
  it('spaces labels further apart when the year label is wider', () => {
    const days = months.map((label, index) => (index === 5 ? 'Jan 5, 2026' : label))
    expect(getCashFlowXAxisTicks(bars(months, 5), 220)).toEqual(['range 1', 'range 5', 'range 9', 'range 13'])
    expect(getCashFlowXAxisTicks(bars(days, 5), 220)).toEqual(['range 0', 'range 5', 'range 10'])
  })
})

describe('getCashFlowXAxisLabelIndexes', () => {
  // Recharts' thinning dropped the January label on a phone, so the year change vanished from the axis
  it('labels every stride-th bar counted from the bar that marks the year, so the steps are even', () => {
    const marksYear = Array.from({ length: 15 }, (_, index) => index === 5)
    expect(getCashFlowXAxisLabelIndexes(marksYear, 3)).toEqual([2, 5, 8, 11, 14])
  })

  it('keeps every bar that marks the year and drops a label closer to one than the stride', () => {
    const marksYear = Array.from({ length: 15 }, (_, index) => index === 5 || index === 12)
    expect(getCashFlowXAxisLabelIndexes(marksYear, 5)).toEqual([0, 5, 12])
  })

  it('labels every bar when they all fit', () => {
    expect(getCashFlowXAxisLabelIndexes([false, true, false], 1)).toEqual([0, 1, 2])
  })
})

describe('getCashFlowAxisTicks', () => {
  // The axis topped out at 1,500.00 for a 1,020.00 bar, which left a third of the chart empty
  it('ends the axis just above the tallest bar, not a whole coarse step past it', () => {
    expect(getCashFlowAxisTicks([102_000, 40_000])).toEqual([0, 20_000, 40_000, 60_000, 80_000, 100_000, 120_000])
    expect(getCashFlowAxisTicks([132_700, 40_000])).toEqual([0, 25_000, 50_000, 75_000, 100_000, 125_000, 150_000])
  })

  it('ends the axis just below the lowest bar when every bar is negative', () => {
    expect(getCashFlowAxisTicks([-102_000, -40_000])).toEqual([
      -120_000, -100_000, -80_000, -60_000, -40_000, -20_000, 0,
    ])
  })

  it('covers negative bars and keeps zero on the axis', () => {
    expect(getCashFlowAxisTicks([-30_000, 70_000])).toEqual([-40_000, -20_000, 0, 20_000, 40_000, 60_000, 80_000])
  })

  it('gives a range of all zeros an axis with a height', () => {
    expect(getCashFlowAxisTicks([0, 0])).toEqual([0, 1])
  })

  it('never puts two ticks closer than one minor unit', () => {
    expect(getCashFlowAxisTicks([1])).toEqual([0, 1])
    expect(getCashFlowAxisTicks([250])).toEqual([0, 50, 100, 150, 200, 250])
  })
})
