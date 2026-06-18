import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createSavedInsightsRange,
  deleteSavedInsightsRange,
  fetchInsightsCashFlow,
  fetchInsightsFundFlow,
  fetchInsightsIncomeExpenseBreakdown,
  fetchInsightsMerchants,
  fetchInsightsNetWorth,
  fetchInsightsPeriodGlance,
  fetchInsightsSavingsRateTrend,
  fetchSavedInsightsRanges,
} from '@/api/insights/requests';
import { insightsKeys } from '@/api/cache/queryKeys';
import { getFxAwareStaleTime } from '@/api/shared/fxCache';
import { useAuth } from '@/hooks/useAuth';
import type { InsightsComparisonPeriod } from '@/pages/insights/types/range';

const INSIGHTS_FX_STALE_TIME_MS = 5 * 60 * 1000;

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
    staleTime: getFxAwareStaleTime(INSIGHTS_FX_STALE_TIME_MS),
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
    staleTime: getFxAwareStaleTime(INSIGHTS_FX_STALE_TIME_MS),
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
    staleTime: getFxAwareStaleTime(INSIGHTS_FX_STALE_TIME_MS),
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
    staleTime: getFxAwareStaleTime(INSIGHTS_FX_STALE_TIME_MS),
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
    staleTime: getFxAwareStaleTime(INSIGHTS_FX_STALE_TIME_MS),
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
    staleTime: getFxAwareStaleTime(INSIGHTS_FX_STALE_TIME_MS),
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
    staleTime: getFxAwareStaleTime(INSIGHTS_FX_STALE_TIME_MS),
  });
}

/**
 * Reads the user's saved relative insights ranges
 */
export function useSavedInsightsRanges(enabled = true) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: insightsKeys.savedRanges(),
    queryFn: fetchSavedInsightsRanges,
    enabled: !!accessToken && enabled,
    staleTime: Infinity,
  });
}

/**
 * Saves a named relative range and refreshes the saved range list
 */
export function useSaveInsightsRange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createSavedInsightsRange,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: insightsKeys.savedRanges() });
    },
  });
}

/**
 * Deletes a saved relative range and refreshes the saved range list
 */
export function useDeleteSavedInsightsRange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteSavedInsightsRange,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: insightsKeys.savedRanges() });
    },
  });
}
