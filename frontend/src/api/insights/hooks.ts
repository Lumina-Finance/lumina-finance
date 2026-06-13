import { useQuery } from '@tanstack/react-query';
import {
  fetchInsightsCashFlow,
  fetchInsightsFundFlow,
  fetchInsightsIncomeExpenseBreakdown,
  fetchInsightsMerchants,
  fetchInsightsNetWorth,
  fetchInsightsPeriodGlance,
  fetchInsightsSavingsRateTrend,
} from '@/api/insights/requests';
import { insightsKeys } from '@/api/cache/queryKeys';
import { useAuth } from '@/hooks/useAuth';
import type { InsightsComparisonPeriod } from '@/insights/types/range';

/**
 * Reads headline insights metrics for a comparison date range
 */
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
 * Reads net worth history for an insights date range
 */
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
 * Reads the global savings-rate trend used by the insights page
 */
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
 * Reads income and expense category movement for a comparison date range
 */
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
 * Reads cash-flow points for an insights date range
 */
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
 * Reads income and expense flow groups for an insights date range
 */
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
 * Reads merchant distribution and ranking data for a comparison date range
 */
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
