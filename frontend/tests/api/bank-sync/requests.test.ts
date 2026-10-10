/**
 * Covers the bank sync request functions that reshape what they send
 *
 * These tests catch the review list losing its place between pages, a body losing the field names
 * the backend reads, such as the setup token a reconnect sends, and a request that waits on the bank
 * provider failing at the shared request limit while the server is still finishing it
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import {
  claimSetupToken,
  createBankLink,
  fetchBulkApprovalPreview,
  fetchReviewPage,
  reconnectBankConnection,
} from '@/api/bank-sync/requests';
import { REQUEST_TIMEOUT_MS } from '@/api/server';

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

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/bank-sync/connections/connection-1/reconnect', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ setup_token: 'token' }),
    }));
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

describe('giving a request that waits on the bank provider time to finish', () => {
  // The server answers each of these only once the provider has taken the setup token and listed the
  // bank accounts, which can outlast an ordinary request. By then the token is spent, so one cut off at
  // the shared limit shows an error the user can't fix by trying the same token again
  it.each([
    ['claiming a setup token', () => claimSetupToken({ provider: 'simplefin', setup_token: 'token' })],
    ['reconnecting', () => reconnectBankConnection({ connectionId: 'connection-1', setupToken: 'token' })],
  ])('waits longer than the shared request limit when %s', async (_label, send) => {
    await send();

    const [, options] = authenticatedFetchMock.mock.calls[0];
    expect(options.timeoutMs).toBeGreaterThan(REQUEST_TIMEOUT_MS);
  });
});
