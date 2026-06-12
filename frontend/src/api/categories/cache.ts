import type { QueryClient } from '@tanstack/react-query';
import {
  invalidateAccounts,
  invalidateBudgets,
  invalidateDashboardBudgets,
  invalidateDashboardIncomeExpense,
  invalidateDashboardRecent,
  invalidateInsightsIncomeExpense,
  invalidateMerchants,
  invalidateTransactionOverview,
  invalidateTransactions,
} from '@/api/cacheInvalidation';
import { categoryKeys } from '@/api/queryKeys';
import type { Category } from '@/api/categories/types';

/**
 * Invalidates views whose rendered labels, rollups, or defaults depend on categories
 */
function invalidateCategoryUsageQueries(queryClient: QueryClient) {
  invalidateTransactions(queryClient);
  invalidateTransactionOverview(queryClient);
  invalidateAccounts(queryClient);
  invalidateDashboardRecent(queryClient);
  invalidateDashboardIncomeExpense(queryClient);
  invalidateInsightsIncomeExpense(queryClient);
  invalidateBudgets(queryClient);
  invalidateDashboardBudgets(queryClient);
  invalidateMerchants(queryClient);
}

/**
 * Inserts a created category into the sorted category list cache
 */
export function updateCategoryCreateCaches(queryClient: QueryClient, category: Category) {
  queryClient.setQueryData<Category[]>(categoryKeys.list(), (categories) =>
    [...(categories ?? []), category].sort((a, b) => a.name.localeCompare(b.name)),
  );
}

/**
 * Updates the category list cache and invalidates category usage data
 */
export function updateCategoryUpdateCaches(queryClient: QueryClient, category: Category) {
  queryClient.setQueryData<Category[]>(categoryKeys.list(), (categories) =>
    categories?.map((currentCategory) => (
      currentCategory.id === category.id ? category : currentCategory
    )) ?? categories,
  );
  invalidateCategoryUsageQueries(queryClient);
}

/**
 * Removes a category from the list cache and invalidates category usage data
 */
export function removeCategoryCaches(queryClient: QueryClient, categoryId: string) {
  queryClient.setQueryData<Category[]>(categoryKeys.list(), (categories) =>
    categories?.filter((category) => category.id !== categoryId) ?? categories,
  );
  invalidateCategoryUsageQueries(queryClient);
}
