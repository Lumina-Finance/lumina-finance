import type { InsightsMerchantsResponse } from '@/api/insights'
import type { MerchantMarketMerchant } from '@/pages/insights/types/merchantDistribution'
import { getChangePercent } from '@/utils/rounding'

/**
 * Maps the merchant distribution response rows into the shape the merchant market map renders. The
 * change in percent is worked out from the change in amount, rounded up like any rise in spending
 */
export function getMerchantDistributionMerchants(
  response: InsightsMerchantsResponse | undefined,
): MerchantMarketMerchant[] {
  return (response?.distribution ?? []).map(([id, name, totalAmount, changeAmount]) => ({
    id,
    name,
    totalAmount,
    changePct: changeAmount === null ? null : getChangePercent(totalAmount, totalAmount - changeAmount, 'up'),
    changeAmount,
  }))
}
