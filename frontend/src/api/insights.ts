import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { authenticatedFetch } from '@/api/client';
import type { FxStatus } from '@/api/dashboard';
import { insightsKeys } from '@/api/queryKeys';
import { buildQueryString } from '@/api/queryString';
import type { InsightsComparisonPeriod } from '@/insights/types/range';

export interface InsightsPeriodGlanceResponse {
  income: number;
  expenses: number;
  income_expense_fx_status: FxStatus;
  net_worth_change: number;
  net_worth_change_fx_status: FxStatus;
  top_category_name?: string;
  top_category_share_pct?: number;
  top_category_fx_status: FxStatus;
  biggest_change_name?: string;
  biggest_change_amount?: number;
  biggest_change_pct?: number;
  biggest_change_fx_status: FxStatus;
}

export type InsightsFlowEntry = [string, number];

export interface InsightsFundFlowResponse {
  income_sources: InsightsFlowEntry[];
  expense_categories: InsightsFlowEntry[];
  income_outflows: InsightsFlowEntry[];
  expense_inflows: InsightsFlowEntry[];
  income_source_count: number;
  expense_category_count: number;
  fx_status: FxStatus;
}

export type InsightsBreakdownCategoryKind = 'expense' | 'income';
export type InsightsBreakdownEntry = [string, string, InsightsBreakdownCategoryKind, number];
export type InsightsCategoryTrendEntry = [string, string, number, number, number | null, number];

export interface InsightsIncomeExpenseBreakdownResponse {
  expense: InsightsBreakdownEntry[];
  income: InsightsBreakdownEntry[];
  expense_total: number;
  income_total: number;
  expense_increases: InsightsCategoryTrendEntry[];
  expense_decreases: InsightsCategoryTrendEntry[];
  income_increases: InsightsCategoryTrendEntry[];
  income_decreases: InsightsCategoryTrendEntry[];
  fx_status: FxStatus;
}

export type InsightsCashFlowPoint = [string, string, number, number];

export interface InsightsCashFlowResponse {
  points: InsightsCashFlowPoint[];
  fx_status: FxStatus;
}

export type InsightsNetWorthGroup = [string, string, 'asset' | 'debt'];
export type InsightsNetWorthPoint = [string, string, number[]];

export interface InsightsNetWorthResponse {
  groups: InsightsNetWorthGroup[];
  baseline: number[];
  points: InsightsNetWorthPoint[];
  fx_status: FxStatus;
}

export type InsightsSavingsRateTrendPoint = [string, number, number];

export interface InsightsSavingsRateTrendResponse {
  points: InsightsSavingsRateTrendPoint[];
  fx_status: FxStatus;
}

export type InsightsMerchantDistributionEntry = [string, string, number, number | null, number | null];

export type InsightsMerchantRankingEntry = [string, string, number, number, number | null];

export interface InsightsMerchantsResponse {
  distribution: InsightsMerchantDistributionEntry[];
  ranking: InsightsMerchantRankingEntry[];
  fx_status: FxStatus;
}

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

export function useInsightsPeriodGlance(
  fromDate: string,
  toDate: string,
  comparisonPeriod: InsightsComparisonPeriod = 'same_length',
  enabled = true,
) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: insightsKeys.periodGlance(fromDate, toDate, comparisonPeriod),
    queryFn: () => fetchInsightsPeriodGlance(fromDate, toDate, comparisonPeriod),
    enabled: !!accessToken && enabled && fromDate !== '' && toDate !== '',
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetches net worth groups and points for an insights date range
 */
export function fetchInsightsNetWorth(fromDate: string, toDate: string) {
  return authenticatedFetch<InsightsNetWorthResponse>(
    `/insights/net-worth${buildInsightsRangeQueryString(fromDate, toDate)}`,
  );
}

export function useInsightsNetWorth(fromDate: string, toDate: string, enabled = true) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: insightsKeys.netWorth(fromDate, toDate),
    queryFn: () => fetchInsightsNetWorth(fromDate, toDate),
    enabled: !!accessToken && enabled && fromDate !== '' && toDate !== '',
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetches the global savings-rate trend used by the insights page
 */
export function fetchInsightsSavingsRateTrend() {
  return authenticatedFetch<InsightsSavingsRateTrendResponse>('/insights/savings-rate-trend');
}

export function useInsightsSavingsRateTrend(enabled = true) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: insightsKeys.savingsRateTrend(),
    queryFn: fetchInsightsSavingsRateTrend,
    enabled: !!accessToken && enabled,
    staleTime: 5 * 60 * 1000,
  });
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

export function useInsightsIncomeExpenseBreakdown(
  fromDate: string,
  toDate: string,
  comparisonPeriod: InsightsComparisonPeriod = 'same_length',
  enabled = true,
) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: insightsKeys.incomeExpenseBreakdown(fromDate, toDate, comparisonPeriod),
    queryFn: () => fetchInsightsIncomeExpenseBreakdown(fromDate, toDate, comparisonPeriod),
    enabled: !!accessToken && enabled && fromDate !== '' && toDate !== '',
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetches cash-flow points for an insights date range
 */
export function fetchInsightsCashFlow(fromDate: string, toDate: string) {
  return authenticatedFetch<InsightsCashFlowResponse>(
    `/insights/cash-flow${buildInsightsRangeQueryString(fromDate, toDate)}`,
  );
}

export function useInsightsCashFlow(fromDate: string, toDate: string, enabled = true) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: insightsKeys.cashFlow(fromDate, toDate),
    queryFn: () => fetchInsightsCashFlow(fromDate, toDate),
    enabled: !!accessToken && enabled && fromDate !== '' && toDate !== '',
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetches income and expense flow groups for an insights date range
 */
export function fetchInsightsFundFlow(fromDate: string, toDate: string) {
  return authenticatedFetch<InsightsFundFlowResponse>(
    `/insights/fund-flow${buildInsightsRangeQueryString(fromDate, toDate)}`,
  );
}

export function useInsightsFundFlow(fromDate: string, toDate: string, enabled = true) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: insightsKeys.fundFlow(fromDate, toDate),
    queryFn: () => fetchInsightsFundFlow(fromDate, toDate),
    enabled: !!accessToken && enabled && fromDate !== '' && toDate !== '',
    staleTime: 5 * 60 * 1000,
  });
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

export function useInsightsMerchants(
  fromDate: string,
  toDate: string,
  comparisonPeriod: InsightsComparisonPeriod = 'same_length',
  enabled = true,
) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: insightsKeys.merchants(fromDate, toDate, comparisonPeriod),
    queryFn: () => fetchInsightsMerchants(fromDate, toDate, comparisonPeriod),
    enabled: !!accessToken && enabled && fromDate !== '' && toDate !== '',
    staleTime: 5 * 60 * 1000,
  });
}
