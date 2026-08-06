/**
 * Covers tax-advantaged category API functions that build nested category and yearly-limit paths
 *
 * These tests catch regressions where category IDs, years,
 * or payload fields are sent to the wrong endpoint or HTTP method
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import {
  createTaxAdvantagedCategory,
  createTaxAdvantagedCategoryLimit,
  deleteTaxAdvantagedCategory,
  deleteTaxAdvantagedCategoryLimit,
  fetchTaxAdvantagedCategory,
  fetchTaxAdvantagedCategoryLimits,
  fetchTaxAdvantagedCategories,
  updateTaxAdvantagedCategory,
  updateTaxAdvantagedCategoryLimit,
} from '@/api/tax-advantaged-categories';

beforeEach(() => {
  authenticatedFetchMock.mockReset();
  authenticatedFetchMock.mockResolvedValue({});
});

describe('tax-advantaged category API functions', () => {
  it('requests category list, detail, and yearly limit endpoints', async () => {
    await fetchTaxAdvantagedCategories();
    await fetchTaxAdvantagedCategory('category_123');
    await fetchTaxAdvantagedCategoryLimits('category_123');

    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(1, '/tax-advantaged-categories');
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(
      2,
      '/tax-advantaged-categories/category_123',
    );
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(
      3,
      '/tax-advantaged-categories/category_123/limits',
    );
  });

  it('creates and updates categories with JSON payloads', async () => {
    const createPayload = {
      name: 'TFSA',
      tax_treatment: 'tax_free' as const,
      currency: 'CAD',
      lifetime_contribution_limit: 9500000,
      accrued_contributions: 2000000,
      group_id: null,
    };
    const updatePayload = {
      name: 'TFSA 2026',
      lifetime_contribution_limit: 10200000,
    };

    await createTaxAdvantagedCategory(createPayload);
    await updateTaxAdvantagedCategory('category_123', updatePayload);

    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(1, '/tax-advantaged-categories', {
      method: 'POST',
      body: JSON.stringify(createPayload),
    });
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(
      2,
      '/tax-advantaged-categories/category_123',
      {
        method: 'PATCH',
        body: JSON.stringify(updatePayload),
      },
    );
  });

  it('deletes categories by ID', async () => {
    await deleteTaxAdvantagedCategory('category_123');

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/tax-advantaged-categories/category_123', {
      method: 'DELETE',
    });
  });

  it('creates yearly limits without sending the category ID in the body', async () => {
    await createTaxAdvantagedCategoryLimit({
      categoryId: 'category_123',
      year: 2026,
      contribution_limit: 700000,
      withdrawal_limit: null,
      accrued_contributions: 100000,
    });

    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      '/tax-advantaged-categories/category_123/limits',
      {
        method: 'POST',
        body: JSON.stringify({
          year: 2026,
          contribution_limit: 700000,
          withdrawal_limit: null,
          accrued_contributions: 100000,
        }),
      },
    );
  });

  it('updates yearly limits without sending route fields in the body', async () => {
    await updateTaxAdvantagedCategoryLimit({
      categoryId: 'category_123',
      year: 2026,
      contribution_limit: 750000,
      accrued_withdrawals: 25000,
    });

    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      '/tax-advantaged-categories/category_123/limits/2026',
      {
        method: 'PATCH',
        body: JSON.stringify({
          contribution_limit: 750000,
          accrued_withdrawals: 25000,
        }),
      },
    );
  });

  it('deletes yearly limits by category and year', async () => {
    await deleteTaxAdvantagedCategoryLimit({ categoryId: 'category_123', year: 2026 });

    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      '/tax-advantaged-categories/category_123/limits/2026',
      {
        method: 'DELETE',
      },
    );
  });
});
