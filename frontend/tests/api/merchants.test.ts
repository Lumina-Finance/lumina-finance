/**
 * Covers merchant API request functions used by settings and transaction selectors
 *
 * These tests catch regressions where merchant detail, create, update, delete,
 * or merge operations call the wrong endpoint or send the wrong method payload
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import {
  createMerchant,
  deleteMerchant,
  fetchMerchant,
  mergeMerchant,
  updateMerchant,
} from '@/api/merchants';

beforeEach(() => {
  authenticatedFetchMock.mockReset();
  authenticatedFetchMock.mockResolvedValue({});
});

describe('merchant API functions', () => {
  it('requests merchant detail records by ID', async () => {
    await fetchMerchant('merchant_123');

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/merchants/merchant_123');
  });

  it('creates merchants with default category and group fields', async () => {
    await createMerchant({
      name: 'Coffee Shop',
      default_category_id: 'cat_123',
      group_id: 'group_123',
    });

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/merchants', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Coffee Shop',
        default_category_id: 'cat_123',
        group_id: 'group_123',
      }),
    });
  });

  it('updates merchant fields with a patch request', async () => {
    await updateMerchant({
      merchantId: 'merchant_123',
      payload: {
        name: 'Coffee Roaster',
        default_category_id: null,
      },
    });

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/merchants/merchant_123', {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'Coffee Roaster',
        default_category_id: null,
      }),
    });
  });

  it('deletes merchant records by ID', async () => {
    await deleteMerchant('merchant_123');

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/merchants/merchant_123', {
      method: 'DELETE',
    });
  });

  it('merges merchants into a replacement merchant', async () => {
    await mergeMerchant({
      merchantId: 'merchant_123',
      payload: {
        replacement_merchant_id: 'merchant_456',
      },
    });

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/merchants/merchant_123/merge', {
      method: 'POST',
      body: JSON.stringify({
        replacement_merchant_id: 'merchant_456',
      }),
    });
  });
});
