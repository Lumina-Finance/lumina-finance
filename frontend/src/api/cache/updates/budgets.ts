import type { QueryClient } from '@tanstack/react-query';
import { invalidateBudgets, invalidateDashboardBudgets } from '@/api/cache/invalidation';

/**
 * Invalidates budget views after budget mutations change dashboard rollups
 */
export function invalidateBudgetActivity(queryClient: QueryClient) {
  invalidateBudgets(queryClient);
  invalidateDashboardBudgets(queryClient);
}
