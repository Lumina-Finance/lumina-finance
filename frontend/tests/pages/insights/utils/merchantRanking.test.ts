/**
 * Covers the merchant ranking rows, so the average spent per transaction rounds up like any expense
 */
import { describe, expect, it } from 'vitest'
import type { InsightsMerchantsResponse } from '@/api/insights'
import { getMerchantRankingRows } from '@/pages/insights/utils/merchantRanking'

describe('merchant ranking rows', () => {
  it('rounds the average per transaction up to whole minor units', () => {
    const [row] = getMerchantRankingRows({
      ranking: [['m1', 'Corner Cafe', 1_000, 3, null]],
    } as unknown as InsightsMerchantsResponse)

    // 1,000 over three transactions is 333.33
    expect(row.averageAmount).toBe(334)
  })

  it('has no average without transactions', () => {
    const [row] = getMerchantRankingRows({
      ranking: [['m1', 'Corner Cafe', 0, 0, null]],
    } as unknown as InsightsMerchantsResponse)

    expect(row.averageAmount).toBe(0)
  })
})
