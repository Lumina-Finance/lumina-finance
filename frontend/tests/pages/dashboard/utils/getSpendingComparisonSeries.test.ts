/**
 * Tests the spending comparison series, so a slot with no reading is left empty rather than filled
 * with a number the backend never sent
 */
import { describe, expect, it } from 'vitest'
import {
  getSpendingAverageSeries,
  getSpendingComparisonSeries,
} from '@/pages/dashboard/utils/getSpendingComparisonSeries'
import { comparison } from './fixtures'

describe('spending comparison series', () => {
  it('builds spending comparison series without inventing values', () => {
    expect(getSpendingComparisonSeries(comparison)).toEqual([
      { label: '1', current: 100, previous: 200, average: 167 },
      { label: '2', current: 300, previous: 400, average: 334 },
      { label: '3', current: 600, previous: 900, average: 601 },
      { label: '4', current: null, previous: 1200, average: 1200 },
      { label: '5', current: null, previous: null, average: null },
    ])
  })

  it('divides each average slot by its own count and rounds up, also below zero', () => {
    const average = getSpendingAverageSeries({
      ...comparison,
      average_sums: [180_000, 10_001, -10_001, 0],
      average_counts: [3, 2, 2, 1],
    })

    // 600.00 over three months is exact, 5000.5 rounds up, and -5000.5 rounds up to -5000
    expect(average).toEqual([60_000, 5_001, -5_000, 0])
  })

  it('has no average without an earlier period', () => {
    expect(getSpendingAverageSeries({ ...comparison, average_sums: [], average_counts: [] })).toEqual([])
    expect(getSpendingAverageSeries(undefined)).toEqual([])
  })
})
