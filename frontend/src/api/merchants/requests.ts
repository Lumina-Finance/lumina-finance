import { authenticatedFetch } from '@/api/client';
import { buildQueryString, type QueryStringValue } from '@/api/utils/queryString';
import type {
  CreateMerchantPayload,
  Merchant,
  MerchantFilters,
  MerchantNameMatch,
  MergeMerchantRequest,
  UpdateMerchantRequest,
} from '@/api/merchants/types';

/**
 * Fetches one filtered merchant page for settings and transaction merchant selectors
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchMerchantsPage(
  filters: MerchantFilters = {},
  pageSize = 20,
  offset = 0,
  signal?: AbortSignal,
) {
  return authenticatedFetch<Merchant[]>(
    '/merchants' +
      buildQueryString({
        ...(filters as Record<string, QueryStringValue>),
        limit: pageSize,
        offset,
      }),
    { signal },
  );
}

/**
 * Fetches a merchant detail record by ID
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchMerchant(merchantId: string | null | undefined, signal?: AbortSignal) {
  return authenticatedFetch<Merchant>(`/merchants/${merchantId}`, { signal });
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

/**
 * Asks which of the merchant names given already have a merchant
 *
 * A read sent as a POST, since a file's worth of merchant names does not fit in a query string. The
 * import page asks this rather than holding every merchant a user has, which can run to thousands
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchMerchantNameMatches(names: string[], signal?: AbortSignal) {
  return authenticatedFetch<MerchantNameMatch[]>('/merchants/name-matches', {
    method: 'POST',
    body: JSON.stringify({ names }),
    signal,
  });
}
