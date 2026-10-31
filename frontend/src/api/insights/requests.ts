import { authenticatedFetch } from '@/api/client'
import { buildQueryString } from '@/api/utils/queryString'
import type {
  InsightsCashFlowResponse,
  InsightsComparisonPeriod,
  InsightsFundFlowResponse,
  InsightsIncomeExpenseBreakdownResponse,
  InsightsMerchantsResponse,
  InsightsNetWorthResponse,
  InsightsPeriodGlanceResponse,
  InsightsSavingsRateTrendResponse,
  SaveInsightsRangePayload,
  SavedInsightsRange,
} from '@/api/insights/types'

/**
 * Builds the backend range query shared by dated insights widgets
 */
function buildInsightsRangeQueryString(fromDate: string, toDate: string, comparisonPeriod?: InsightsComparisonPeriod) {
  return buildQueryString({
    from_date: fromDate,
    to_date: toDate,
    comparison_period: comparisonPeriod,
  })
}

/**
 * Fetches headline metrics for an insights date range
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchInsightsPeriodGlance(
  fromDate: string,
  toDate: string,
  comparisonPeriod: InsightsComparisonPeriod = 'same_length',
  signal?: AbortSignal,
) {
  return authenticatedFetch<InsightsPeriodGlanceResponse>(
    `/insights/period-glance${buildInsightsRangeQueryString(fromDate, toDate, comparisonPeriod)}`,
    { signal },
  )
}

/**
 * Fetches net worth groups and points for an insights date range
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchInsightsNetWorth(fromDate: string, toDate: string, signal?: AbortSignal) {
  return authenticatedFetch<InsightsNetWorthResponse>(
    `/insights/net-worth${buildInsightsRangeQueryString(fromDate, toDate)}`,
    { signal },
  )
}

/**
 * Fetches the global savings-rate trend used by the insights page
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchInsightsSavingsRateTrend(signal?: AbortSignal) {
  return authenticatedFetch<InsightsSavingsRateTrendResponse>('/insights/savings-rate-trend', { signal })
}

/**
 * Fetches income and expense category movement for an insights date range
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchInsightsIncomeExpenseBreakdown(
  fromDate: string,
  toDate: string,
  comparisonPeriod: InsightsComparisonPeriod = 'same_length',
  signal?: AbortSignal,
) {
  return authenticatedFetch<InsightsIncomeExpenseBreakdownResponse>(
    `/insights/income-expense-breakdown${buildInsightsRangeQueryString(fromDate, toDate, comparisonPeriod)}`,
    { signal },
  )
}

/**
 * Fetches cash-flow points for an insights date range
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchInsightsCashFlow(fromDate: string, toDate: string, signal?: AbortSignal) {
  return authenticatedFetch<InsightsCashFlowResponse>(
    `/insights/cash-flow${buildInsightsRangeQueryString(fromDate, toDate)}`,
    { signal },
  )
}

/**
 * Fetches income and expense flow groups for an insights date range
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchInsightsFundFlow(fromDate: string, toDate: string, signal?: AbortSignal) {
  return authenticatedFetch<InsightsFundFlowResponse>(
    `/insights/fund-flow${buildInsightsRangeQueryString(fromDate, toDate)}`,
    { signal },
  )
}

/**
 * Fetches merchant distribution and ranking data for an insights date range
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchInsightsMerchants(
  fromDate: string,
  toDate: string,
  comparisonPeriod: InsightsComparisonPeriod = 'same_length',
  signal?: AbortSignal,
) {
  return authenticatedFetch<InsightsMerchantsResponse>(
    `/insights/merchants${buildInsightsRangeQueryString(fromDate, toDate, comparisonPeriod)}`,
    { signal },
  )
}

/**
 * Fetches the user's saved relative insights ranges, newest first
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchSavedInsightsRanges(signal?: AbortSignal) {
  return authenticatedFetch<SavedInsightsRange[]>('/insights/saved-ranges', { signal })
}

/**
 * Saves a named relative insights range
 */
export function createSavedInsightsRange(payload: SaveInsightsRangePayload) {
  return authenticatedFetch<SavedInsightsRange>('/insights/saved-ranges', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * Deletes a saved relative insights range by ID
 */
export function deleteSavedInsightsRange(rangeId: string) {
  return authenticatedFetch<void>(`/insights/saved-ranges/${rangeId}`, {
    method: 'DELETE',
  })
}
