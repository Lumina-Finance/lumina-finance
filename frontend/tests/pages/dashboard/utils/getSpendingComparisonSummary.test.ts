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
    expect(summary.spendingXAxisTicks).toEqual(['1', '3', '5'])
    expect(summary.firstSpendingXAxisTick).toBe('1')
    expect(summary.lastSpendingXAxisTick).toBe('5')
    expect(summary.spendingPointsByLabel.get('4')).toMatchObject({ previous: 1200 })
    expect(summary.currentHasData).toBe(true)
    expect(summary.previousHasData).toBe(true)
    expect(summary.spentToDate).toBe(600)
    expect(summary.spendingDeltaPct).toBeCloseTo(-33.333, 3)
    expect(summary.spendingDeltaText).toBe('-33.3%')
  })
})
