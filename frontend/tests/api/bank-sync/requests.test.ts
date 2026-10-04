/**
 * Covers the bank sync request functions, the contract the backend routes implement
 *
 * These tests catch a request reaching the wrong path, method or query string, a body losing the
 * field names the backend reads, such as the version bulk approval checks, and a review decision
 * answered with no content being read as a transaction
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import {
  applyBulkApproval,
  createBankLink,
  fetchBulkApprovalPreview,
  fetchDiscoveredBankAccounts,
  fetchPendingBankTransactions,
  fetchReviewPage,
  reconnectBankConnection,
  resolveReviewItem,
  restoreBankValue,
  syncBankLink,
} from '@/api/bank-sync/requests';

beforeEach(() => {
  authenticatedFetchMock.mockReset();
  authenticatedFetchMock.mockResolvedValue({});
});

describe('bank sync reads', () => {
  it('reads one account review page from the cursor the last page gave, in pages of fifty', async () => {
    await fetchReviewPage({ accountId: 'account-1', cursor: 'cursor-2' });

    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      '/bank-review/items?account_id=account-1&cursor=cursor-2&limit=50',
    );
  });

  it('reads the first page across every account without an account or a cursor', async () => {
    await fetchReviewPage({ cursor: null });

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/bank-review/items?limit=50');
  });

  it('reads the bank accounts a connection returns relative to the account being linked', async () => {
    await fetchDiscoveredBankAccounts('connection-1', 'account-1');

    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      '/bank-sync/connections/connection-1/accounts?for_account_id=account-1',
    );
  });

  it('reads pending rows for every account when no account is given', async () => {
    await fetchPendingBankTransactions();
    await fetchPendingBankTransactions('account-1');

    expect(authenticatedFetchMock.mock.calls).toEqual([
      ['/bank-sync/pending'],
      ['/bank-sync/pending?account_id=account-1'],
    ]);
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

  it('asks for a sync with no body', async () => {
    await syncBankLink('account-1');

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/accounts/account-1/bank-link/sync', {
      method: 'POST',
      body: undefined,
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

  it('applies bulk approval with the version of each previewed item', async () => {
    await applyBulkApproval({ items: [{ id: 'item-1', version: 3 }, { id: 'item-2', version: 1 }] });

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/bank-review/bulk-approve', {
      method: 'POST',
      body: JSON.stringify({ items: [{ id: 'item-1', version: 3 }, { id: 'item-2', version: 1 }] }),
    });
  });

  it('settles a review item through its resolution path and passes on an empty answer', async () => {
    authenticatedFetchMock.mockResolvedValue(undefined);

    await expect(resolveReviewItem({ itemId: 'item-1', resolution: 'remove-from-ledger' })).resolves.toBeUndefined();
    expect(authenticatedFetchMock).toHaveBeenCalledWith('/bank-review/items/item-1/remove-from-ledger', {
      method: 'POST',
      body: undefined,
    });
  });

  it('restores one bank value on a transaction', async () => {
    await restoreBankValue({ transactionId: 'transaction-1', field: 'amount' });

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/bank-sync/transaction-sources/transaction-1/restore', {
      method: 'POST',
      body: JSON.stringify({ field: 'amount' }),
    });
  });
});
