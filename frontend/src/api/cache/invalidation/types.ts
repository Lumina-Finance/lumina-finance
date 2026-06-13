import type { QueryClient, QueryKey } from '@tanstack/react-query';

export interface InvalidationTarget {
  queryKey: QueryKey;
  exact?: boolean;
}

/**
 * Invalidates query targets once while preserving active refetch behaviour
 */
export function invalidateTargets(queryClient: QueryClient, targets: InvalidationTarget[]) {
  const seen = new Set<string>();
  for (const target of targets) {
    const cacheKey = JSON.stringify([target.queryKey, target.exact ?? false]);
    if (seen.has(cacheKey)) continue;
    seen.add(cacheKey);

    queryClient.invalidateQueries({
      queryKey: target.queryKey,
      exact: target.exact ?? false,
      refetchType: 'active',
    });
  }
}

/**
 * Removes empty IDs before building detail invalidation targets
 */
export function uniqueIds(ids: Array<string | null | undefined>) {
  return [...new Set(ids.filter((id): id is string => !!id))];
}
