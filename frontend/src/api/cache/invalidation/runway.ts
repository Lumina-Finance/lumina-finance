import type { QueryClient } from '@tanstack/react-query';
import { userKeys } from '@/api/cache/queryKeys';
import { invalidateTargets, type InvalidationTarget } from '@/api/cache/invalidation/types';

export const runwayTargets: InvalidationTarget[] = [
  { queryKey: userKeys.runwayAccounts(), exact: true },
  { queryKey: userKeys.runwaySettings(), exact: true },
  { queryKey: userKeys.runway(), exact: true },
];

/**
 * Invalidates runway result data
 */
export function invalidateRunway(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: userKeys.runway(), exact: true }]);
}

/**
 * Invalidates runway settings and result data
 */
export function invalidateRunwaySettings(queryClient: QueryClient) {
  invalidateTargets(queryClient, runwayTargets);
}
