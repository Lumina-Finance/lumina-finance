import type { InsightsMerchantsResponse } from '@/api/insights'
import type { MerchantRankingRow } from '@/pages/insights/types/merchantRanking'
import { divideRounded, getChangePercent } from '@/utils/rounding'

/**
 * Maps the merchant ranking response rows into ranking rows, computing the average transaction
 * amount and the change from the previous period for each merchant. Spending more rounds the change
 * up, so it never reads better than it is
 */
export function getMerchantRankingRows(
  response: InsightsMerchantsResponse | undefined,
): MerchantRankingRow[] {
  return (response?.ranking ?? []).map(([id, name, totalAmount, transactionCount, previousAmount]) => ({
    id,
    name,
    totalAmount,
    transactionCount,
    averageAmount: transactionCount > 0 ? divideRounded(totalAmount, transactionCount, 'up') : 0,
    changePct: getChangePercent(totalAmount, previousAmount, 'up'),
  }))
}
