/**
 * Covers the bank sync request functions that reshape what they send
 *
 * These tests catch the review list losing its place between pages, and a body losing the field names
 * the backend reads, such as the setup token a reconnect sends
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import {
  createBankLink,
  fetchBulkApprovalPreview,
  fetchReviewPage,
  reconnectBankConnection,
} from '@/api/bank-sync/requests';

beforeEach(() => {
  authenticatedFetchMock.mockReset();
  authenticatedFetchMock.mockResolvedValue({});
});

describe('bank sync reads', () => {
  it('reads the review page of two accounts from the cursor the last page gave, in pages of fifty', async () => {
    await fetchReviewPage({ accountIds: ['account-1', 'account-2'], cursor: 'cursor-2' });

    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      '/bank-review/items?account_id=account-1&account_id=account-2&cursor=cursor-2&limit=50',
    );
  });
});

describe('bank sync writes', () => {
  it('links through the account path and leaves the account out of the body', async () => {
    await createBankLink({
      account_id: 'account-1',
      connection_id: 'connection-1',
      external_account_id: 'bank-account-1',
      start_date: '2026-01-01',
    });

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/accounts/account-1/bank-link', {
      method: 'POST',
      body: JSON.stringify({
        connection_id: 'connection-1',
        external_account_id: 'bank-account-1',
        start_date: '2026-01-01',
      }),
    });
  });

  it('sends the new setup token under the name the backend reads when reconnecting', async () => {
    await reconnectBankConnection({ connectionId: 'connection-1', setupToken: 'token' });

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/bank-sync/connections/connection-1/reconnect', {
      method: 'POST',
      body: JSON.stringify({ setup_token: 'token' }),
    });
  });

  it('previews bulk approval for every account with a null account list', async () => {
    await fetchBulkApprovalPreview();
    await fetchBulkApprovalPreview(['account-1']);

    expect(authenticatedFetchMock.mock.calls.map(([, options]) => options.body)).toEqual([
      JSON.stringify({ account_ids: null }),
      JSON.stringify({ account_ids: ['account-1'] }),
    ]);
  });
});
