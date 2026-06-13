import type { QueryClient } from '@tanstack/react-query';
import { budgetKeys } from '@/api/cache/queryKeys';
import { invalidateTargets } from '@/api/cache/invalidation/types';

/**
 * Invalidates all budget queries
 */
export function invalidateBudgets(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: budgetKeys.all }]);
}
