/**
 * Covers the merchant distribution rows, so the change in percent is worked out from the change in
 * amount and rounds up like any rise in spending
 */
import { describe, expect, it } from 'vitest'
import type { InsightsMerchantsResponse } from '@/api/insights'
import { getMerchantDistributionMerchants } from '@/pages/insights/utils/merchantDistribution'

function changeOf(total: number, changeAmount: number | null) {
  return getMerchantDistributionMerchants({
    distribution: [['m1', 'Corner Cafe', total, changeAmount]],
  } as unknown as InsightsMerchantsResponse)[0].changePct
}

describe('merchant distribution rows', () => {
  it('rounds the change up from the amounts, so a small rise is not read as no change', () => {
    // 1,001 against 1,000 is 0.1%, and 995 against 1,000 is -0.5%
    expect(changeOf(1_001, 1)).toBe(1)
    expect(changeOf(995, -5)).toBe(0)
    expect(changeOf(900, -100)).toBe(-10)
  })

  it('has no percent for a merchant with no spend to compare with, or a rolled-up one', () => {
    expect(changeOf(1_000, 1_000)).toBeNull()
    expect(changeOf(1_000, null)).toBeNull()
  })
})
