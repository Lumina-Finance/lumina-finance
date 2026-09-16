import type { QueryClient } from '@tanstack/react-query';
import { currencyKeys } from '@/api/cache/queryKeys';

/**
 * Clears user queries and mutations while retaining the exact public currency query
 *
 * Keeping its query object preserves freshness, observers and any in-flight currency request
 */
export function clearUserScopedCache(queryClient: QueryClient): void {
  const currencies = queryClient.getQueryCache().find({ queryKey: currencyKeys.list(), exact: true });
  queryClient.removeQueries({ predicate: (query) => query !== currencies });
  queryClient.getMutationCache().clear();
}
