import type { TransactionsOverview } from '@/api/transactions'

export type TransactionOverviewState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'empty'; message: string }
  | { kind: 'content' }

/**
 * Selects the visible transaction-overview presentation from its query result
 *
 * @param overview - The settled or cached overview value
 * @param loading - Whether the loading presentation is currently visible
 * @param failed - Whether the current overview request settled as an error
 * @param rangeLabel - The date-range wording used by genuine empty states
 * @returns The single presentation the overview band should render
 */
export function selectTransactionOverviewState({
  overview,
  loading,
  failed,
  rangeLabel,
}: {
  overview: TransactionsOverview | undefined
  loading: boolean
  failed: boolean
  rangeLabel: string
}): TransactionOverviewState {
  if (loading) return { kind: 'loading' }
  if (failed) return { kind: 'failed' }

  const hasTransactions = overview?.total_inflow !== null && overview?.total_inflow !== undefined
  const hasNetFlowData =
    (overview?.total_inflow ?? 0) !== 0 || (overview?.total_outflow ?? 0) !== 0
  const hasOutlierData = (overview?.outliers?.length ?? 0) > 0
  const hasCategoryData = (overview?.top_categories?.length ?? 0) > 0
  const hasDailyCashFlowData = overview?.daily_cash_flow?.some(
    (day) => day.inflow !== 0 || day.outflow !== 0,
  ) ?? false

  if (hasNetFlowData || hasOutlierData || hasCategoryData || hasDailyCashFlowData) {
    return { kind: 'content' }
  }

  return {
    kind: 'empty',
    message: hasTransactions
      ? `No qualifying transactions for ${rangeLabel}`
      : `No transaction data for ${rangeLabel}.`,
  }
}
