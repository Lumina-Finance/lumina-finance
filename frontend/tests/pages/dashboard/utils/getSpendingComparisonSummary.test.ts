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
    expect(summary.previousHasData).toBe(true)
    expect(summary.spentToDate).toBe(600)
    expect(summary.spendingDeltaPct).toBeCloseTo(-33.333, 3)
    expect(summary.spendingDeltaText).toBe('−33.3%')
  })

  it.each([28, 29, 30, 31])(
    'keeps the last day label and never labels the day beside it in a %i day month',
    (days) => {
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
    },
  )
})
