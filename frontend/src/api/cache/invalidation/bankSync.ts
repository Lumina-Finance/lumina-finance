import type { QueryClient } from '@tanstack/react-query';
import { bankSyncKeys } from '@/api/cache/queryKeys';
import { invalidateTargets } from '@/api/cache/invalidation/types';

/**
 * Invalidates what shows how links and connections stand: each account's bank link status, the
 * connections with their request budgets, and the providers with the institutions in use
 */
export function invalidateBankSyncStatus(queryClient: QueryClient) {
  invalidateTargets(queryClient, [
    { queryKey: bankSyncKeys.accountAll },
    { queryKey: bankSyncKeys.connections(), exact: true },
    { queryKey: bankSyncKeys.providers(), exact: true },
  ]);
}

/**
 * Invalidates what waits outside the ledger: the review inbox, any bulk approval preview and the
 * pending strip
 */
export function invalidateBankReview(queryClient: QueryClient) {
  invalidateTargets(queryClient, [
    { queryKey: bankSyncKeys.reviewAll },
    { queryKey: bankSyncKeys.bulkPreviews },
    { queryKey: bankSyncKeys.pendingAll },
  ]);
}

/**
 * Invalidates the review inbox and any bulk approval preview listing its items, leaving the pending
 * strip, which only a sync changes
 */
export function invalidateBankReviewItems(queryClient: QueryClient) {
  invalidateTargets(queryClient, [
    { queryKey: bankSyncKeys.reviewAll },
    { queryKey: bankSyncKeys.bulkPreviews },
  ]);
}

/**
 * Invalidates the link list, whose waiting counts and pause move with every review decision
 */
export function invalidateBankLinks(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: bankSyncKeys.links(), exact: true }]);
}
