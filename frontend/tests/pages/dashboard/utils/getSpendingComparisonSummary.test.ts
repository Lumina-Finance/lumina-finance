/**
 * Tests the spending comparison summary, so the axis ticks, the running total and the change against
 * the previous period cannot drift from the readings that are actually present
 */
import { describe, expect, it } from 'vitest'
import { getSpendingComparisonSummary } from '@/pages/dashboard/utils/getSpendingComparisonSummary'
import { comparison } from './fixtures'

describe('spending comparison summary', () => {
  it('builds spending comparison summary gaps without inventing values', () => {
    const summary = getSpendingComparisonSummary(comparison, 'MTD')
    expect(summary.spendingXAxisTicks).toEqual(['1', '5'])
    expect(summary.firstSpendingXAxisTick).toBe('1')
    expect(summary.lastSpendingXAxisTick).toBe('5')
    expect(summary.spendingPointsByLabel.get('4')).toMatchObject({ previous: 1200 })
    expect(summary.currentHasData).toBe(true)
    expect(summary.comparisonHasData).toBe(true)
    expect(summary.spentToDate).toBe(600)
    expect(summary.spendingDeltaPct).toBe(-33.3)
    expect(summary.spendingDeltaText).toBe('−33.3%')
  })

  it('compares with the average at the same offset when the average is shown', () => {
    const summary = getSpendingComparisonSummary(comparison, 'MTD', 'average')
    // 600 against an average of 601 is -0.17%, which rounds up to -0.1%
    expect(summary.spentToDate).toBe(600)
    expect(summary.spendingDeltaPct).toBe(-0.1)
  })

  it('has no change against an average that does not exist', () => {
    const summary = getSpendingComparisonSummary(
      { ...comparison, average_sums: [], average_counts: [] },
      'MTD',
      'average',
    )
    expect(summary.comparisonHasData).toBe(false)
    expect(summary.spendingDeltaPct).toBeNull()
  })

  it('rounds the change in spending up, so growth reads larger and a fall reads smaller', () => {
    const grown = getSpendingComparisonSummary(
      { ...comparison, current: [100, 100, 1000], previous: [200, 400, 900] },
      'MTD',
    )
    // 1000 against 900 is +11.11%
    expect(grown.spendingDeltaText).toBe('+11.2%')

    const fallen = getSpendingComparisonSummary(
      { ...comparison, current: [100, 100, 700], previous: [200, 400, 900] },
      'MTD',
    )
    // 700 against 900 is -22.22%
    expect(fallen.spendingDeltaText).toBe('−22.2%')
  })

  it.each([
    ['QTD', 13],
    ['QTD', 14],
    ['YTD', 12],
  ] as const)(
    'labels every other slot of a %s of %i slots, ending on the last and never beside the first or last',
    (range, slots) => {
      const slotLabels = Array.from({ length: slots }, (_, index) => `S${index + 1}`)
      const summary = getSpendingComparisonSummary(
        { ...comparison, slot_labels: slotLabels, current: [], previous: [] },
        range,
      )
      const labelled = summary.spendingXAxisTicks.map((label) => Number(label.slice(1)))
      expect(labelled[0]).toBe(1)
      expect(labelled.at(-1)).toBe(slots)
      for (let index = 1; index < labelled.length; index += 1) {
        expect(labelled[index] - labelled[index - 1]).toBeGreaterThanOrEqual(2)
      }
      expect(slots - labelled.at(-2)!).toBeGreaterThanOrEqual(3)
    },
  )

  it('labels every day of a week', () => {
    const slotLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    const summary = getSpendingComparisonSummary(
      { ...comparison, slot_labels: slotLabels, current: [], previous: [] },
      'WTD',
    )
    expect(summary.spendingXAxisTicks).toEqual(slotLabels)
  })

  it.each([28, 29, 30, 31])('keeps the last day label and never labels the day beside it in a %i day month', (days) => {
    const slotLabels = Array.from({ length: days }, (_, index) => String(index + 1))
    const summary = getSpendingComparisonSummary(
      { ...comparison, slot_labels: slotLabels, current: [], previous: [] },
      'MTD',
    )
    const labelledDays = summary.spendingXAxisTicks.map(Number)
    expect(summary.lastSpendingXAxisTick).toBe(String(days))
    expect(labelledDays[0]).toBe(1)
    for (let index = 1; index < labelledDays.length; index += 1) {
      expect(labelledDays[index] - labelledDays[index - 1]).toBeGreaterThanOrEqual(2)
    }
    // The last label is end-aligned, so it needs three days of room, measured at 320px wide
    expect(days - labelledDays[labelledDays.length - 2]).toBeGreaterThanOrEqual(3)
    // Every other day stays labelled before that
    expect(labelledDays.slice(0, -2).every((day) => day % 2 === 1)).toBe(true)
  })
})
