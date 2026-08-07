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
 * Invalidates which of a file's payee values already have a merchant
 *
 * A new merchant changes the answer for any value reading like it, and that answer decides whether
 * an import step offers to create one, so it cannot outlive the merchant list it was worked out from
 */
export function invalidateMerchantNameMatches(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: merchantKeys.nameMatchesAll }]);
}

/**
 * Invalidates tag reference data
 */
export function invalidateTags(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: tagKeys.all }]);
}
