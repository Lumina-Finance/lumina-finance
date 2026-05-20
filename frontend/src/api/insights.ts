import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { authenticatedFetch } from '@/api/client';
import { insightsKeys } from '@/api/queryKeys';

export interface InsightsPeriodGlanceResponse {
  income: number;
  expenses: number;
  net_worth_change: number;
  top_category_name?: string;
  top_category_share_pct?: number;
  biggest_change_name?: string;
  biggest_change_amount?: number;
  biggest_change_pct?: number;
}

export type InsightsFlowEntry = [string, number];

export interface InsightsIncomeExpenseFlowResponse {
  income_sources: InsightsFlowEntry[];
  expense_categories: InsightsFlowEntry[];
  income_outflows: InsightsFlowEntry[];
  expense_inflows: InsightsFlowEntry[];
  income_source_count: number;
  expense_category_count: number;
}

export type InsightsBreakdownEntry = [string, string, number];
export type InsightsCategoryTrendEntry = [string, string, number, number, number | null, number];

export interface InsightsIncomeExpenseBreakdownResponse {
  expense: InsightsBreakdownEntry[];
  income: InsightsBreakdownEntry[];
  expense_increases: InsightsCategoryTrendEntry[];
  expense_decreases: InsightsCategoryTrendEntry[];
  income_increases: InsightsCategoryTrendEntry[];
  income_decreases: InsightsCategoryTrendEntry[];
}

export type InsightsNetWorthGroup = [string, string, 'asset' | 'debt'];
export type InsightsNetWorthPoint = [string, string, number[]];

export interface InsightsNetWorthResponse {
  groups: InsightsNetWorthGroup[];
  points: InsightsNetWorthPoint[];
}

export type InsightsSavingsRateTrendPoint = [string, number, number];

export interface InsightsSavingsRateTrendResponse {
  points: InsightsSavingsRateTrendPoint[];
}

export type InsightsMerchantDistributionEntry = [string, string, number, number | null, number | null];

export interface InsightsMerchantDistributionResponse {
  merchants: InsightsMerchantDistributionEntry[];
}

export type InsightsMerchantRankingEntry = [string, string, number, number, number | null];

export interface InsightsMerchantRankingResponse {
  merchants: InsightsMerchantRankingEntry[];
}

export function useInsightsPeriodGlance(fromDate: string, toDate: string, enabled = true) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: insightsKeys.periodGlance(fromDate, toDate),
    queryFn: () =>
      authenticatedFetch<InsightsPeriodGlanceResponse>(
        `/insights/period-glance?from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}`,
      ),
    enabled: !!accessToken && enabled && fromDate !== '' && toDate !== '',
    staleTime: 5 * 60 * 1000,
  });
}

export function useInsightsNetWorth(fromDate: string, toDate: string, enabled = true) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: insightsKeys.netWorth(fromDate, toDate),
    queryFn: () =>
      authenticatedFetch<InsightsNetWorthResponse>(
        `/insights/net-worth?from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}`,
      ),
    enabled: !!accessToken && enabled && fromDate !== '' && toDate !== '',
    staleTime: 5 * 60 * 1000,
  });
}

export function useInsightsSavingsRateTrend(enabled = true) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: insightsKeys.savingsRateTrend(),
    queryFn: () =>
      authenticatedFetch<InsightsSavingsRateTrendResponse>('/insights/savings-rate-trend'),
    enabled: !!accessToken && enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useInsightsIncomeExpenseBreakdown(fromDate: string, toDate: string, enabled = true) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: insightsKeys.incomeExpenseBreakdown(fromDate, toDate),
    queryFn: () =>
      authenticatedFetch<InsightsIncomeExpenseBreakdownResponse>(
        `/insights/income-expense-breakdown?from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}`,
      ),
    enabled: !!accessToken && enabled && fromDate !== '' && toDate !== '',
    staleTime: 5 * 60 * 1000,
  });
}

export function useInsightsIncomeExpenseFlow(fromDate: string, toDate: string, enabled = true) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: insightsKeys.incomeExpenseFlow(fromDate, toDate),
    queryFn: () =>
      authenticatedFetch<InsightsIncomeExpenseFlowResponse>(
        `/insights/income-expense-flow?from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}`,
      ),
    enabled: !!accessToken && enabled && fromDate !== '' && toDate !== '',
    staleTime: 5 * 60 * 1000,
  });
}

export function useInsightsMerchantDistribution(fromDate: string, toDate: string, enabled = true) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: insightsKeys.merchantDistribution(fromDate, toDate),
    queryFn: () =>
      authenticatedFetch<InsightsMerchantDistributionResponse>(
        `/insights/merchant-distribution?from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}`,
      ),
    enabled: !!accessToken && enabled && fromDate !== '' && toDate !== '',
    staleTime: 5 * 60 * 1000,
  });
}

export function useInsightsMerchantRanking(fromDate: string, toDate: string, enabled = true) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: insightsKeys.merchantRanking(fromDate, toDate),
    queryFn: () =>
      authenticatedFetch<InsightsMerchantRankingResponse>(
        `/insights/merchant-ranking?from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}`,
      ),
    enabled: !!accessToken && enabled && fromDate !== '' && toDate !== '',
    staleTime: 5 * 60 * 1000,
  });
}
