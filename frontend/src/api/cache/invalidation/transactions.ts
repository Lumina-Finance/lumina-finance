import type { QueryClient } from '@tanstack/react-query';
import { transactionKeys, transactionOverviewKeys } from '@/api/cache/queryKeys';
import { invalidateTargets } from '@/api/cache/invalidation/types';

/**
 * Invalidates transaction list and detail queries
 */
export function invalidateTransactions(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: transactionKeys.all }]);
}

/**
 * Invalidates transaction overview summaries built from filtered transaction data
 */
export function invalidateTransactionOverview(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: transactionOverviewKeys.all }]);
}
