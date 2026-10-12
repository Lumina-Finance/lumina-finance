import { authenticatedFetch } from '@/api/client';
import type {
  CreateTaxAdvantagedCategoryLimitPayload,
  CreateTaxAdvantagedCategoryPayload,
  TaxAdvantagedCategory,
  TaxAdvantagedCategoryLimit,
  UpdateTaxAdvantagedCategoryLimitPayload,
  UpdateTaxAdvantagedCategoryPayload,
} from '@/api/tax-advantaged-categories/types';

/**
 * Fetches tax-advantaged category summaries
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchTaxAdvantagedCategories(signal?: AbortSignal) {
  return authenticatedFetch<TaxAdvantagedCategory[]>('/tax-advantaged-categories', { signal });
}

/**
 * Creates a tax-advantaged category
 */
export function createTaxAdvantagedCategory(payload: CreateTaxAdvantagedCategoryPayload) {
  return authenticatedFetch<TaxAdvantagedCategory>('/tax-advantaged-categories', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Updates mutable tax-advantaged category fields
 */
export function updateTaxAdvantagedCategory(
  categoryId: string,
  payload: UpdateTaxAdvantagedCategoryPayload,
) {
  return authenticatedFetch<TaxAdvantagedCategory>(`/tax-advantaged-categories/${categoryId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/**
 * Deletes a tax-advantaged category
 */
export function deleteTaxAdvantagedCategory(categoryId: string) {
  return authenticatedFetch<void>(`/tax-advantaged-categories/${categoryId}`, {
    method: 'DELETE',
  });
}

/**
 * Fetches yearly limits for one tax-advantaged category
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchTaxAdvantagedCategoryLimits(
  categoryId: string | undefined,
  signal?: AbortSignal,
) {
  return authenticatedFetch<TaxAdvantagedCategoryLimit[]>(
    `/tax-advantaged-categories/${categoryId}/limits`,
    { signal },
  );
}

/**
 * Creates a yearly limit under a tax-advantaged category
 */
export function createTaxAdvantagedCategoryLimit({
  categoryId,
  ...payload
}: CreateTaxAdvantagedCategoryLimitPayload) {
  return authenticatedFetch<TaxAdvantagedCategoryLimit>(
    `/tax-advantaged-categories/${categoryId}/limits`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

/**
 * Updates a yearly limit under a tax-advantaged category
 */
export function updateTaxAdvantagedCategoryLimit({
  categoryId,
  year,
  ...payload
}: UpdateTaxAdvantagedCategoryLimitPayload) {
  return authenticatedFetch<TaxAdvantagedCategoryLimit>(
    `/tax-advantaged-categories/${categoryId}/limits/${year}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );
}

/**
 * Deletes a yearly limit from a tax-advantaged category
 */
export function deleteTaxAdvantagedCategoryLimit({
  categoryId,
  year,
}: {
  categoryId: string;
  year: number;
}) {
  return authenticatedFetch<void>(`/tax-advantaged-categories/${categoryId}/limits/${year}`, {
    method: 'DELETE',
  });
}

/**
 * Fetches one tax-advantaged category by ID
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchTaxAdvantagedCategory(
  categoryId: string | null | undefined,
  signal?: AbortSignal,
) {
  return authenticatedFetch<TaxAdvantagedCategory>(`/tax-advantaged-categories/${categoryId}`, { signal });
}
