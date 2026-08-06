/**
 * Tests the spending comparison series, so a slot with no reading is left empty rather than filled
 * with a number the backend never sent
 */
import { describe, expect, it } from 'vitest'
import { getSpendingComparisonSeries } from '@/pages/dashboard/utils/getSpendingComparisonSeries'
import { comparison } from './fixtures'

describe('spending comparison series', () => {
  it('builds spending comparison series without inventing values', () => {
    expect(getSpendingComparisonSeries(comparison)).toEqual([
      { label: '1', current: 100, previous: 200 },
      { label: '2', current: 300, previous: 400 },
      { label: '3', current: 600, previous: 900 },
      { label: '4', current: null, previous: 1200 },
      { label: '5', current: null, previous: null },
    ])
  })
})
