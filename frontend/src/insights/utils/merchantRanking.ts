import type { InsightsMerchantsResponse } from '@/api/insights'
import type { MerchantRankingRow } from '@/insights/types/merchantRanking'

export function getMerchantRankingRows(
  response: InsightsMerchantsResponse | undefined,
): MerchantRankingRow[] {
  return (response?.ranking ?? []).map(([id, name, totalAmount, transactionCount, changePct]) => ({
    id,
    name,
    totalAmount,
    transactionCount,
    averageAmount: transactionCount > 0 ? Math.round(totalAmount / transactionCount) : 0,
    changePct,
  }))
}
