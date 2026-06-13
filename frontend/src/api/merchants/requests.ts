import { authenticatedFetch } from '@/api/client';
import { buildQueryString, type QueryStringValue } from '@/api/utils/queryString';
import type {
  CreateMerchantPayload,
  Merchant,
  MerchantFilters,
  MergeMerchantRequest,
  UpdateMerchantRequest,
} from '@/api/merchants/types';

/**
 * Fetches one filtered merchant page for settings and transaction merchant selectors
 */
export function fetchMerchantsPage(filters: MerchantFilters = {}, pageSize = 20, offset = 0) {
  return authenticatedFetch<Merchant[]>(
    '/merchants' +
      buildQueryString({
        ...(filters as Record<string, QueryStringValue>),
        limit: pageSize,
        offset,
      }),
  );
}

/**
 * Fetches a merchant detail record by ID
 */
export function fetchMerchant(merchantId: string | null | undefined) {
  return authenticatedFetch<Merchant>(`/merchants/${merchantId}`);
}

/**
 * Creates a merchant reference record
 */
export function createMerchant(payload: CreateMerchantPayload) {
  return authenticatedFetch<Merchant>('/merchants', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Updates editable merchant fields
 */
export function updateMerchant({ merchantId, payload }: UpdateMerchantRequest) {
  return authenticatedFetch<Merchant>(`/merchants/${merchantId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/**
 * Deletes a merchant reference record
 */
export function deleteMerchant(merchantId: string) {
  return authenticatedFetch<void>(`/merchants/${merchantId}`, {
    method: 'DELETE',
  });
}

/**
 * Merges one merchant into a replacement merchant
 */
export function mergeMerchant({ merchantId, payload }: MergeMerchantRequest) {
  return authenticatedFetch<void>(`/merchants/${merchantId}/merge`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
