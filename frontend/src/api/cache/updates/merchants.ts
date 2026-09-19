import type { QueryClient } from '@tanstack/react-query';
import {
  invalidateDashboardRecent,
  invalidateInsightsMerchants,
  invalidateMerchantNameMatches,
  invalidateMerchantLookupPages,
  invalidateMerchants,
  invalidateTransactionOverview,
  invalidateTransactions,
} from '@/api/cache/invalidation';
import { merchantKeys } from '@/api/cache/queryKeys';
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
 * Caches a created merchant's detail and refreshes ranked lists and name matches
 */
export function updateMerchantCreateCaches(queryClient: QueryClient, merchant: Merchant) {
  queryClient.setQueryData<Merchant>(merchantKeys.detail(merchant.id), merchant);
  invalidateMerchantLookupPages(queryClient);

  // A newly created merchant can resolve an imported payee that previously had no match
  invalidateMerchantNameMatches(queryClient);
}

/**
 * Caches edited merchant details and refreshes ranked lists and affected usage data
 */
export function updateMerchantUpdateCaches(
  queryClient: QueryClient,
  merchant: Merchant,
  payload: UpdateMerchantPayload,
) {
  queryClient.setQueryData<Merchant>(merchantKeys.detail(merchant.id), merchant);
  if ('name' in payload) {
    invalidateMerchantUsageQueries(queryClient);
  } else {
    invalidateMerchantLookupPages(queryClient);
  }
}

/**
 * Removes stale merchant detail data and invalidates views that may still reference it
 */
export function removeMerchantCaches(queryClient: QueryClient, merchantId: string) {
  queryClient.removeQueries({ queryKey: merchantKeys.detail(merchantId), exact: true });
  invalidateMerchantUsageQueries(queryClient);
}
