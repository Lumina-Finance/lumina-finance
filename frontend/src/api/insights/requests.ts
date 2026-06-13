import { authenticatedFetch } from '@/api/client';
import { buildQueryString } from '@/api/utils/queryString';
import type {
  InsightsCashFlowResponse,
  InsightsFundFlowResponse,
  InsightsIncomeExpenseBreakdownResponse,
  InsightsMerchantsResponse,
  InsightsNetWorthResponse,
  InsightsPeriodGlanceResponse,
  InsightsSavingsRateTrendResponse,
} from '@/api/insights/types';
import type { InsightsComparisonPeriod } from '@/insights/types/range';

/**
 * Builds the backend range query shared by dated insights widgets
 */
function buildInsightsRangeQueryString(
  fromDate: string,
  toDate: string,
  comparisonPeriod?: InsightsComparisonPeriod,
) {
  return buildQueryString({
    from_date: fromDate,
    to_date: toDate,
    comparison_period: comparisonPeriod,
  });
}

/**
 * Fetches headline metrics for an insights date range
 */
export function fetchInsightsPeriodGlance(
  fromDate: string,
  toDate: string,
  comparisonPeriod: InsightsComparisonPeriod = 'same_length',
) {
  return authenticatedFetch<InsightsPeriodGlanceResponse>(
    `/insights/period-glance${buildInsightsRangeQueryString(fromDate, toDate, comparisonPeriod)}`,
  );
}

/**
 * Fetches net worth groups and points for an insights date range
 */
export function fetchInsightsNetWorth(fromDate: string, toDate: string) {
  return authenticatedFetch<InsightsNetWorthResponse>(
    `/insights/net-worth${buildInsightsRangeQueryString(fromDate, toDate)}`,
  );
}

/**
 * Fetches the global savings-rate trend used by the insights page
 */
export function fetchInsightsSavingsRateTrend() {
  return authenticatedFetch<InsightsSavingsRateTrendResponse>('/insights/savings-rate-trend');
}

/**
 * Fetches income and expense category movement for an insights date range
 */
export function fetchInsightsIncomeExpenseBreakdown(
  fromDate: string,
  toDate: string,
  comparisonPeriod: InsightsComparisonPeriod = 'same_length',
) {
  return authenticatedFetch<InsightsIncomeExpenseBreakdownResponse>(
    `/insights/income-expense-breakdown${buildInsightsRangeQueryString(
      fromDate,
      toDate,
      comparisonPeriod,
    )}`,
  );
}

/**
 * Fetches cash-flow points for an insights date range
 */
export function fetchInsightsCashFlow(fromDate: string, toDate: string) {
  return authenticatedFetch<InsightsCashFlowResponse>(
    `/insights/cash-flow${buildInsightsRangeQueryString(fromDate, toDate)}`,
  );
}

/**
 * Fetches income and expense flow groups for an insights date range
 */
export function fetchInsightsFundFlow(fromDate: string, toDate: string) {
  return authenticatedFetch<InsightsFundFlowResponse>(
    `/insights/fund-flow${buildInsightsRangeQueryString(fromDate, toDate)}`,
  );
}

/**
 * Fetches merchant distribution and ranking data for an insights date range
 */
export function fetchInsightsMerchants(
  fromDate: string,
  toDate: string,
  comparisonPeriod: InsightsComparisonPeriod = 'same_length',
) {
  return authenticatedFetch<InsightsMerchantsResponse>(
    `/insights/merchants${buildInsightsRangeQueryString(fromDate, toDate, comparisonPeriod)}`,
  );
}
