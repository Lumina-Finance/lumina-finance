import type { QueryClient } from '@tanstack/react-query';
import { accountKeys, taxAdvantagedCategoryKeys } from '@/api/cache/queryKeys';
import { invalidateTargets, uniqueIds } from '@/api/cache/invalidation/types';

/**
 * Invalidates tax-advantaged category lists and optional detail records
 */
export function invalidateTaxAdvantagedCategories(
  queryClient: QueryClient,
  categoryIds: Array<string | null | undefined> = [],
) {
  const uniqueCategoryIds = uniqueIds(categoryIds);
  invalidateTargets(queryClient, [
    { queryKey: taxAdvantagedCategoryKeys.list(), exact: true },
    ...uniqueCategoryIds.map((categoryId) => ({
      queryKey: taxAdvantagedCategoryKeys.detail(categoryId),
      exact: true,
    })),
  ]);
}

/**
 * Invalidates tax-advantaged category overview data shown with account summaries
 */
export function invalidateTaxAdvantagedCategoryOverview(queryClient: QueryClient) {
  invalidateTargets(queryClient, [
    { queryKey: taxAdvantagedCategoryKeys.list(), exact: true },
    { queryKey: accountKeys.list(), exact: true },
  ]);
}
