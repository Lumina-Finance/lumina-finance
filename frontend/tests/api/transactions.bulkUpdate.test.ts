/**
 * Covers the request a bulk transaction edit sends, since the endpoint applies all of it or none
 * and a field left out of the body is a change the user asked for and did not get
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import { bulkUpdateTransactions } from '@/api/transactions';

beforeEach(() => {
  authenticatedFetchMock.mockReset();
  authenticatedFetchMock.mockResolvedValue({ transactions_updated: 0, affected_account_ids: [] });
});

describe('bulkUpdateTransactions', () => {
  it('sends the ticked transactions and the chosen category', async () => {
    await bulkUpdateTransactions({
      transaction_ids: ['txn_1', 'txn_2'],
      category_id: 'cat_1',
    });

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/transactions/bulk', {
      method: 'PATCH',
      body: JSON.stringify({ transaction_ids: ['txn_1', 'txn_2'], category_id: 'cat_1' }),
    });
  });

  it('sends a merchant and added tags together', async () => {
    await bulkUpdateTransactions({
      transaction_ids: ['txn_1'],
      merchant_id: 'mer_1',
      add_tag_ids: ['tag_1', 'tag_2'],
    });

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/transactions/bulk', {
      method: 'PATCH',
      body: JSON.stringify({
        transaction_ids: ['txn_1'],
        merchant_id: 'mer_1',
        add_tag_ids: ['tag_1', 'tag_2'],
      }),
    });
  });
});
