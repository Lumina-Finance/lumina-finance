import type { InsightsMerchantsResponse } from '@/api/insights'
import type { MerchantMarketMerchant } from '@/pages/insights/types/merchantDistribution'

/**
 * Maps the merchant distribution response rows into the shape the merchant market map renders
 */
export function getMerchantDistributionMerchants(
  response: InsightsMerchantsResponse | undefined,
): MerchantMarketMerchant[] {
  return (response?.distribution ?? []).map(([id, name, totalAmount, changePct, changeAmount]) => ({
    id,
    name,
    totalAmount,
    changePct,
    changeAmount,
  }))
}
