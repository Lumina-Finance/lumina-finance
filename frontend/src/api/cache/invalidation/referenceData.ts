import type { QueryClient } from '@tanstack/react-query';
import {
  categoryKeys,
  institutionKeys,
  merchantKeys,
  tagKeys,
} from '@/api/cache/queryKeys';
import { invalidateTargets, type InvalidationTarget } from '@/api/cache/invalidation/types';

export const referenceDataTargets: InvalidationTarget[] = [
  { queryKey: categoryKeys.list(), exact: true },
  { queryKey: merchantKeys.all },
  { queryKey: tagKeys.all },
  { queryKey: institutionKeys.list(), exact: true },
];

/**
 * Invalidates merchant reference data
 */
export function invalidateMerchants(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: merchantKeys.all }]);
}

/**
 * Invalidates tag reference data
 */
export function invalidateTags(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: tagKeys.all }]);
}
