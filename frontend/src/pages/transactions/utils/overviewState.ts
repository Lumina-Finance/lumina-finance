import type { TransactionsOverview } from '@/api/transactions'

/** Shown over the summary band while the applied dates cover more than 20 years */
export const OVERVIEW_RANGE_TOO_LONG_MESSAGE =
  "The summary can't cover more than 20 years. Please choose a shorter date range."

export type TransactionOverviewState =
  { kind: 'loading' } | { kind: 'failed' } | { kind: 'empty'; message: string } | { kind: 'content' }

/**
 * Selects the visible transaction-overview presentation from its query result
 *
 * @param overview - The settled or cached overview value
 * @param loading - Whether the loading presentation is currently visible
 * @param failed - Whether the current overview request settled as an error
 * @param rangeLabel - The date-range wording used by genuine empty states
 * @param rangeTooLong - Whether the applied dates cover more than a summary can, so none was asked for
 * @returns The single presentation the overview band should render
 */
export function selectTransactionOverviewState({
  overview,
  loading,
  failed,
  retrying = false,
  rangeLabel,
  rangeTooLong = false,
}: {
  overview: TransactionsOverview | undefined
  loading: boolean
  failed: boolean
  retrying?: boolean
  rangeLabel: string
  rangeTooLong?: boolean
}): TransactionOverviewState {
  // Nothing was requested, so there is no failure to retry and nothing to wait for
  if (rangeTooLong) return { kind: 'empty', message: OVERVIEW_RANGE_TOO_LONG_MESSAGE }
  // Explicit retries keep the failure view mounted while its button supplies loading feedback
  if (retrying) return { kind: 'failed' }
  if (loading) return { kind: 'loading' }
  if (failed) return { kind: 'failed' }

  const hasTransactions = overview?.total_inflow !== null && overview?.total_inflow !== undefined
  const hasNetFlowData = (overview?.total_inflow ?? 0) !== 0 || (overview?.total_outflow ?? 0) !== 0
  const hasOutlierData = (overview?.outliers?.length ?? 0) > 0
  const hasCategoryData = (overview?.top_categories?.length ?? 0) > 0
  const hasDailyCashFlowData = overview?.daily_cash_flow?.some((day) => day.inflow !== 0 || day.outflow !== 0) ?? false

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
