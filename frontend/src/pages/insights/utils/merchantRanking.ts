import type { InsightsMerchantsResponse } from '@/api/insights'
import type { MerchantRankingRow } from '@/pages/insights/types/merchantRanking'
import { divideRounded } from '@/utils/rounding'

/**
 * Maps the merchant ranking response rows into ranking rows, computing the average transaction
 * amount for each merchant
 */
export function getMerchantRankingRows(
  response: InsightsMerchantsResponse | undefined,
): MerchantRankingRow[] {
  return (response?.ranking ?? []).map(([id, name, totalAmount, transactionCount, changePct]) => ({
    id,
    name,
    totalAmount,
    transactionCount,
    averageAmount: transactionCount > 0 ? divideRounded(totalAmount, transactionCount, 'up') : 0,
    changePct,
  }))
}
