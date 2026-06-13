import type { InsightsMerchantsResponse } from '@/api/insights'
import type { MerchantMarketMerchant } from '@/insights/types/merchantDistribution'

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
