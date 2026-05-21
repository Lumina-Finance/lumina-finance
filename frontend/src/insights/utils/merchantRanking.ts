import type { InsightsMerchantRankingResponse } from '@/api/insights'
import type { MerchantRankingRow } from '../components/MerchantRankingCard'

export function getMerchantRankingRows(
  response: InsightsMerchantRankingResponse | undefined,
): MerchantRankingRow[] {
  return (response?.merchants ?? []).map(([id, name, totalAmount, transactionCount, changePct]) => ({
    id,
    name,
    totalAmount,
    transactionCount,
    averageAmount: transactionCount > 0 ? Math.round(totalAmount / transactionCount) : 0,
    changePct,
  }))
}
