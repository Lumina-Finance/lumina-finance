import type { QueryClient } from '@tanstack/react-query';
import { budgetKeys, dashboardKeys } from '@/api/cache/queryKeys';
import { invalidateTargets, type InvalidationTarget } from '@/api/cache/invalidation/types';

export const dashboardBalanceTargets: InvalidationTarget[] = [
  { queryKey: dashboardKeys.netWorthAll },
];

export const dashboardCreditTargets: InvalidationTarget[] = [
  { queryKey: dashboardKeys.credit(), exact: true },
];

export const dashboardRecentTargets: InvalidationTarget[] = [
  { queryKey: dashboardKeys.recentActivityAll },
];

export const dashboardIncomeExpenseTargets: InvalidationTarget[] = [
  { queryKey: dashboardKeys.savingsRateAll },
  { queryKey: dashboardKeys.spendingComparisonAll },
  { queryKey: dashboardKeys.spendingBreakdownAll },
];

export const dashboardBudgetTargets: InvalidationTarget[] = [
  { queryKey: budgetKeys.latestUtilizations(), exact: true },
];

export const dashboardTargets: InvalidationTarget[] = [
  ...dashboardBalanceTargets,
  ...dashboardCreditTargets,
  ...dashboardRecentTargets,
  ...dashboardIncomeExpenseTargets,
  ...dashboardBudgetTargets,
];

/**
 * Invalidates dashboard balance widgets
 */
export function invalidateDashboardBalance(queryClient: QueryClient) {
  invalidateTargets(queryClient, dashboardBalanceTargets);
}

/**
 * Invalidates dashboard credit widgets
 */
export function invalidateDashboardCredit(queryClient: QueryClient) {
  invalidateTargets(queryClient, dashboardCreditTargets);
}

/**
 * Invalidates dashboard recent activity widgets
 */
export function invalidateDashboardRecent(queryClient: QueryClient) {
  invalidateTargets(queryClient, dashboardRecentTargets);
}

/**
 * Invalidates dashboard income and expense widgets
 */
export function invalidateDashboardIncomeExpense(queryClient: QueryClient) {
  invalidateTargets(queryClient, dashboardIncomeExpenseTargets);
}

/**
 * Invalidates dashboard budget widgets
 */
export function invalidateDashboardBudgets(queryClient: QueryClient) {
  invalidateTargets(queryClient, dashboardBudgetTargets);
}

/**
 * Invalidates every dashboard widget query
 */
export function invalidateDashboardData(queryClient: QueryClient) {
  invalidateTargets(queryClient, dashboardTargets);
}
