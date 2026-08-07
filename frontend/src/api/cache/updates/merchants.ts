import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import {
  invalidateDashboardRecent,
  invalidateInsightsMerchants,
  invalidateMerchantNameMatches,
  invalidateMerchants,
  invalidateTransactionOverview,
  invalidateTransactions,
} from '@/api/cache/invalidation';
import { merchantKeys } from '@/api/cache/queryKeys';
import {
  isInfiniteReferenceLookupQueryKey,
  referenceLookupMatchesFilters,
  removeReferenceLookupFromInfiniteData,
  upsertReferenceLookupIntoInfiniteData,
} from '@/api/cache/utils/referenceLookup';
import type { Merchant, UpdateMerchantPayload } from '@/api/merchants/types';

/**
 * Invalidates views whose rendered transaction labels or rollups depend on merchants
 */
function invalidateMerchantUsageQueries(queryClient: QueryClient) {
  invalidateMerchants(queryClient);
  invalidateTransactions(queryClient);
  invalidateTransactionOverview(queryClient);
  invalidateDashboardRecent(queryClient);
  invalidateInsightsMerchants(queryClient);
}

/**
 * Updates cached merchant lookup pages after create or update mutations
 */
function updateMerchantLookupPages(
  queryClient: QueryClient,
  merchant: Merchant,
  removeWhenFilteredOut: boolean,
) {
  queryClient.getQueryCache()
    .findAll({ queryKey: merchantKeys.all, exact: false })
    .forEach((query) => {
      const queryKey = query.queryKey;
      if (!isInfiniteReferenceLookupQueryKey(queryKey, 'merchants')) return;

      queryClient.setQueryData<InfiniteData<Merchant[]>>(
        queryKey,
        (data) => {
          if (referenceLookupMatchesFilters(merchant, queryKey[2])) {
            return upsertReferenceLookupIntoInfiniteData(data, merchant);
          }

          return removeWhenFilteredOut
            ? removeReferenceLookupFromInfiniteData(data, merchant.id)
            : data;
        },
      );
    });
}

/**
 * Writes a newly created merchant into detail and matching lookup caches
 */
export function updateMerchantCreateCaches(queryClient: QueryClient, merchant: Merchant) {
  queryClient.setQueryData<Merchant>(merchantKeys.detail(merchant.id), merchant);
  updateMerchantLookupPages(queryClient, merchant, false);

  // The lookup pages can be written into, since a new merchant simply joins them. What a file's
  // payee values match cannot, because the answer says which values have no merchant yet, and this
  // one may be what a value was waiting for
  invalidateMerchantNameMatches(queryClient);
}

/**
 * Updates merchant detail and lookup caches after editable fields change
 */
export function updateMerchantUpdateCaches(
  queryClient: QueryClient,
  merchant: Merchant,
  payload: UpdateMerchantPayload,
) {
  queryClient.setQueryData<Merchant>(merchantKeys.detail(merchant.id), merchant);
  updateMerchantLookupPages(queryClient, merchant, true);
  if ('name' in payload) invalidateMerchantUsageQueries(queryClient);
}

/**
 * Removes stale merchant detail data and invalidates views that may still reference it
 */
export function removeMerchantCaches(queryClient: QueryClient, merchantId: string) {
  queryClient.removeQueries({ queryKey: merchantKeys.detail(merchantId), exact: true });
  invalidateMerchantUsageQueries(queryClient);
}
