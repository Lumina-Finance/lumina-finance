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
 * Marks transaction lists and overview summaries stale without refetching the ones on screen, for a
 * deleted account whose page is the only screen still showing them, while it animates out. Each is
 * fetched again when a screen next shows it
 */
export function markTransactionsStale(queryClient: QueryClient) {
  for (const queryKey of [transactionKeys.all, transactionOverviewKeys.all]) {
    queryClient.invalidateQueries({ queryKey, refetchType: 'none' });
  }
}

/**
 * Invalidates transaction overview summaries built from filtered transaction data
 */
export function invalidateTransactionOverview(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: transactionOverviewKeys.all }]);
}
