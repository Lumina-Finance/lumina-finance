import type { InsightsMerchantDistributionResponse } from '@/api/insights'
import type { MerchantMarketMerchant } from '../components/MerchantDistributionCard'

export function getMerchantDistributionMerchants(
  response: InsightsMerchantDistributionResponse | undefined,
): MerchantMarketMerchant[] {
  return (response?.merchants ?? []).map(([id, name, totalAmount, changePct, changeAmount]) => ({
    id,
    name,
    totalAmount,
    changePct,
    changeAmount,
  }))
}
