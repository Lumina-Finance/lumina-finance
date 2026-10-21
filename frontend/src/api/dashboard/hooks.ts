import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { updateCreditUtilizationCache } from '@/api/cache/updates/dashboard';
import {
  fetchDashboardCredit,
  fetchDashboardCreditUtilization,
  fetchDashboardNetWorth,
  fetchDashboardRecentActivity,
  fetchDashboardSavingsRate,
  fetchSpendingBreakdown,
  fetchSpendingComparison,
  replaceCreditExcludedAccounts,
} from '@/api/dashboard/requests';
import type { SpendingRange } from '@/api/dashboard/types';
import { dashboardKeys } from '@/api/cache/queryKeys';
import { getFxAwareStaleTime } from '@/api/shared/fxCache';
import { useAuth } from '@/hooks/useAuth';

const DASHBOARD_FX_STALE_TIME_MS = 10 * 60 * 1000;

/**
 * Reads dashboard credit utilization data
 */
export function useDashboardCredit() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.credit(),
    queryFn: ({ signal }) => fetchDashboardCredit(signal),
    enabled: !!accessToken,
    staleTime: getFxAwareStaleTime(DASHBOARD_FX_STALE_TIME_MS),
  });
}

/**
 * Reads the credit totals the dashboard credit widget shows, counting only the accounts the user chose
 */
export function useDashboardCreditUtilization() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.creditUtilization(),
    queryFn: ({ signal }) => fetchDashboardCreditUtilization(signal),
    enabled: !!accessToken,
    staleTime: getFxAwareStaleTime(DASHBOARD_FX_STALE_TIME_MS),
  });
}

/**
 * Saves which credit accounts are left out of the dashboard credit widget
 */
export function useReplaceCreditExcludedAccounts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: replaceCreditExcludedAccounts,
    onSuccess: (utilization) => {
      updateCreditUtilizationCache(queryClient, utilization);
    },
  });
}

/**
 * Reads dashboard net worth history for a rolling day window
 */
export function useDashboardNetWorth(windowDays = 90) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.netWorth(windowDays),
    queryFn: ({ signal }) => fetchDashboardNetWorth(windowDays, signal),
    enabled: !!accessToken,
    staleTime: getFxAwareStaleTime(DASHBOARD_FX_STALE_TIME_MS),
  });
}

/**
 * Reads dashboard savings-rate history
 */
export function useDashboardSavingsRate() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.savingsRate(),
    queryFn: ({ signal }) => fetchDashboardSavingsRate(signal),
    enabled: !!accessToken,
    staleTime: getFxAwareStaleTime(DASHBOARD_FX_STALE_TIME_MS),
  });
}

/**
 * Reads recent dashboard transactions for a rolling day window
 */
export function useDashboardRecentActivity(windowDays = 90) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.recentActivity(windowDays),
    queryFn: ({ signal }) => fetchDashboardRecentActivity(windowDays, signal),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Reads cumulative spending comparison data for a calendar range
 */
export function useSpendingComparison(range: SpendingRange) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.spendingComparison(range),
    queryFn: ({ signal }) => fetchSpendingComparison(range, signal),
    enabled: !!accessToken,
    staleTime: getFxAwareStaleTime(DASHBOARD_FX_STALE_TIME_MS),
  });
}

/**
 * Reads category-level dashboard spending breakdown for a calendar range
 */
export function useSpendingBreakdown(range: SpendingRange) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.spendingBreakdown(range),
    queryFn: ({ signal }) => fetchSpendingBreakdown(range, signal),
    enabled: !!accessToken,
    staleTime: getFxAwareStaleTime(DASHBOARD_FX_STALE_TIME_MS),
  });
}
