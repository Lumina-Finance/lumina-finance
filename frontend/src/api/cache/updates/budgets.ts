import type { QueryClient } from '@tanstack/react-query';
import { invalidateBudgets, invalidateDashboardBudgets } from '@/api/cache/invalidation';
import { budgetKeys } from '@/api/cache/queryKeys';
import type { BaseBudget, Budget } from '@/api/budgets/types';

/**
 * Invalidates budget views after budget mutations change dashboard rollups
 */
export function invalidateBudgetActivity(queryClient: QueryClient) {
  invalidateBudgets(queryClient);
  invalidateDashboardBudgets(queryClient);
}

/**
 * Writes an updated base budget into the base-budget list and every cached period that embeds it
 */
export function updateCachedBaseBudget(queryClient: QueryClient, baseBudget: BaseBudget) {
  // Base-budget list drives the budgets page split between active and archived cards
  queryClient.setQueryData<BaseBudget[]>(budgetKeys.baseBudgets(), (baseBudgets) => {
    if (!baseBudgets) return baseBudgets;
    return baseBudgets.map((item) => (item.id === baseBudget.id ? baseBudget : item));
  });

  // Period rows carry a base_budget copy that budget cards prefer over the list entry, so keep both aligned
  queryClient.setQueryData<Budget[]>(budgetKeys.periods(), (periods) => {
    if (!periods) return periods;
    return periods.map((period) =>
      period.base_budget_id === baseBudget.id ? { ...period, base_budget: baseBudget } : period,
    );
  });
}
