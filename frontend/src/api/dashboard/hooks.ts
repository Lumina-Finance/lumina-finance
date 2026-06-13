import { useQuery } from '@tanstack/react-query';
import {
  fetchDashboardCredit,
  fetchDashboardNetWorth,
  fetchDashboardRecentActivity,
  fetchDashboardSavingsRate,
  fetchSpendingBreakdown,
  fetchSpendingComparison,
} from '@/api/dashboard/requests';
import type { SpendingRange } from '@/api/dashboard/types';
import { dashboardKeys } from '@/api/cache/queryKeys';
import { useAuth } from '@/hooks/useAuth';

/**
 * Reads dashboard credit utilization data
 */
export function useDashboardCredit() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.credit(),
    queryFn: fetchDashboardCredit,
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Reads dashboard net worth history for a rolling day window
 */
export function useDashboardNetWorth(windowDays = 90) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.netWorth(windowDays),
    queryFn: () => fetchDashboardNetWorth(windowDays),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Reads dashboard savings-rate history
 */
export function useDashboardSavingsRate() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.savingsRate(),
    queryFn: fetchDashboardSavingsRate,
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Reads recent dashboard transactions for a rolling day window
 */
export function useDashboardRecentActivity(windowDays = 90) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.recentActivity(windowDays),
    queryFn: () => fetchDashboardRecentActivity(windowDays),
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
    queryFn: () => fetchSpendingComparison(range),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Reads category-level dashboard spending breakdown for a calendar range
 */
export function useSpendingBreakdown(range: SpendingRange) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.spendingBreakdown(range),
    queryFn: () => fetchSpendingBreakdown(range),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}
