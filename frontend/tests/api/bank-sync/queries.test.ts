/**
 * Covers how the bank link list is read and how Sync now writes its answer into it, through the
 * query cache the app runs on
 *
 * These tests catch a server without the route being asked again on every retry or every screen
 * that opens, a read that failed on the way not being tried once more, a screen opening moments
 * after a read asking for the list again, a Sync now answer waiting for the next poll to show, a
 * Sync now reading as started before a worker has started it, including on a link made after the
 * list was read, and a refused Sync now leaving an out-of-date status in place
 */
import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBankLink, createSyncStatus } from './fixtures';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import { ApiError } from '@/api/auth/errors';
import { BANK_LINKS_ACTIVE_POLL_MS } from '@/api/bank-sync/constants';
import { bankLinksQueryOptions, syncBankAccountMutationOptions } from '@/api/bank-sync/hooks';
import { getBankLinksPollInterval } from '@/api/bank-sync/polling';
import type { BankLink } from '@/api/bank-sync/types';
import { bankSyncKeys } from '@/api/cache/queryKeys';

let queryClient: QueryClient;
let unsubscribes: Array<() => void> = [];

beforeEach(() => {
  authenticatedFetchMock.mockReset();

  // No wait between attempts, which the library otherwise spaces a second apart
  queryClient = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
});

afterEach(() => {
  for (const unsubscribe of unsubscribes) unsubscribe();
  unsubscribes = [];
  queryClient.clear();
  vi.useRealTimers();
});

/** Mounts a reader of the link list, the way a screen showing bank status does, once any read it starts has settled */
async function mountReader(): Promise<void> {
  const observer = new QueryObserver(queryClient, bankLinksQueryOptions);
  unsubscribes.push(observer.subscribe(() => {}));
  await vi.waitFor(() => expect(observer.getCurrentResult().fetchStatus).toBe('idle'));
}

describe('the link list read', () => {
  it('asks a server that refused the read once, without a retry, and not again for the next screen', async () => {
    authenticatedFetchMock.mockRejectedValue(new ApiError('Not Found', 404));

    await mountReader();
    await mountReader();

    expect(authenticatedFetchMock).toHaveBeenCalledOnce();
  });

  it('tries a read that failed on the way once more, and leaves it failed for the next screen', async () => {
    authenticatedFetchMock.mockRejectedValue(new TypeError('Network unavailable'));

    await mountReader();
    expect(authenticatedFetchMock).toHaveBeenCalledTimes(2);

    await mountReader();
    expect(authenticatedFetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives a screen opening moments after a read the list it read', async () => {
    authenticatedFetchMock.mockResolvedValue([createBankLink()]);

    await mountReader();
    await mountReader();

    expect(authenticatedFetchMock.mock.calls).toEqual([['/bank-sync/links']]);
  });
});

describe('a Sync now answer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.setQueryData(bankSyncKeys.links(), [createBankLink(), createBankLink({ account_id: 'account-2' })]);
  });

  /** Asks for a sync of the first account, letting the clock run past the minimum time a pending button shows for */
  async function syncNow(): Promise<MutationObserver<BankLink, Error, string>> {
    const observer = new MutationObserver(queryClient, syncBankAccountMutationOptions(queryClient));
    void observer.mutate('account-1').catch(() => {});
    await vi.runAllTimersAsync();
    return observer;
  }

  it('goes into the cached list at once, taking the poll to its fast pace, and settles only once the poll shows a worker started the sync', async () => {
    // The server queued the sync, which no worker has started yet, so the link still reads as synced
    authenticatedFetchMock.mockResolvedValue(createBankLink({ sync: createSyncStatus({ sync_requested: true }) }));

    const observer = await syncNow();

    const links = queryClient.getQueryData<BankLink[]>(bankSyncKeys.links());
    expect(authenticatedFetchMock).toHaveBeenCalledWith('/accounts/account-1/bank-link/sync', expect.objectContaining({ method: 'POST' }));
    expect(links?.map((link) => [link.account_id, link.sync.state, link.sync.sync_requested]))
      .toEqual([['account-1', 'synced', true], ['account-2', 'synced', false]]);
    expect(getBankLinksPollInterval(links, null)).toBe(BANK_LINKS_ACTIVE_POLL_MS);
    expect(observer.getCurrentResult().isPending).toBe(true);

    // The next poll finds a worker running the sync
    queryClient.setQueryData(bankSyncKeys.links(), [
      createBankLink({ sync: createSyncStatus({ state: 'syncing' }) }),
      createBankLink({ account_id: 'account-2' }),
    ]);
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
    expect(queryClient.getQueryState(bankSyncKeys.links())?.isInvalidated).toBe(false);
  });

  it('goes last into a list read before the link was made, so the poll still follows the sync and waits for a worker to start it', async () => {
    // The page read the list, or restored it from storage, before the link was made on another device
    queryClient.setQueryData(bankSyncKeys.links(), [createBankLink({ account_id: 'account-2' })]);
    authenticatedFetchMock.mockResolvedValue(createBankLink({ sync: createSyncStatus({ sync_requested: true }) }));

    const observer = await syncNow();

    const links = queryClient.getQueryData<BankLink[]>(bankSyncKeys.links());
    expect(links?.map((link) => [link.account_id, link.sync.sync_requested])).toEqual([['account-2', false], ['account-1', true]]);
    expect(getBankLinksPollInterval(links, null)).toBe(BANK_LINKS_ACTIVE_POLL_MS);
    expect(observer.getCurrentResult().isPending).toBe(true);
  });

  it('marks the list for reading again when the server refuses the sync, since the status shown is out of date', async () => {
    authenticatedFetchMock.mockRejectedValue(new ApiError('Conflict', 409));

    await syncNow();

    expect(queryClient.getQueryState(bankSyncKeys.links())?.isInvalidated).toBe(true);
    expect(queryClient.getQueryData<BankLink[]>(bankSyncKeys.links())?.map((link) => link.sync.state)).toEqual(['synced', 'synced']);
  });
});
