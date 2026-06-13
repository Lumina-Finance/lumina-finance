import type { QueryClient } from '@tanstack/react-query';
import { insightsKeys } from '@/api/cache/queryKeys';
import { invalidateTargets, type InvalidationTarget } from '@/api/cache/invalidation/types';

export const insightsBalanceTargets: InvalidationTarget[] = [
  { queryKey: insightsKeys.periodGlanceAll },
  { queryKey: insightsKeys.netWorthAll },
];

export const insightsIncomeExpenseTargets: InvalidationTarget[] = [
  { queryKey: insightsKeys.periodGlanceAll },
  { queryKey: insightsKeys.fundFlowAll },
  { queryKey: insightsKeys.incomeExpenseBreakdownAll },
  { queryKey: insightsKeys.cashFlowAll },
  { queryKey: insightsKeys.savingsRateTrendAll },
];

export const insightsMerchantTargets: InvalidationTarget[] = [
  { queryKey: insightsKeys.merchantsAll },
];

export const insightsTargets: InvalidationTarget[] = [
  ...insightsBalanceTargets,
  ...insightsIncomeExpenseTargets,
  ...insightsMerchantTargets,
];

/**
 * Invalidates insights balance and net worth cards
 */
export function invalidateInsightsBalance(queryClient: QueryClient) {
  invalidateTargets(queryClient, insightsBalanceTargets);
}

/**
 * Invalidates insights income and expense cards
 */
export function invalidateInsightsIncomeExpense(queryClient: QueryClient) {
  invalidateTargets(queryClient, insightsIncomeExpenseTargets);
}

/**
 * Invalidates insights merchant cards
 */
export function invalidateInsightsMerchants(queryClient: QueryClient) {
  invalidateTargets(queryClient, insightsMerchantTargets);
}

/**
 * Invalidates every insights query
 */
export function invalidateInsightsData(queryClient: QueryClient) {
  invalidateTargets(queryClient, insightsTargets);
}
