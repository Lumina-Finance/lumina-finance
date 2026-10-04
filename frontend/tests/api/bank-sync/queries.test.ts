/**
 * Covers how the bank link list is read and how Sync now writes its answer into it, through the
 * query cache the app runs on
 *
 * These tests catch a server without the route being asked again on every retry or every screen
 * that opens, a read that failed on the way not being tried once more, a screen opening moments
 * after a read asking for the list again, and a Sync now answer waiting for the next poll to show
 */
import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBankLink } from './fixtures';

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
  it('goes into the cached list at once, which takes the poll to its fast pace', async () => {
    vi.useFakeTimers();
    queryClient.setQueryData(bankSyncKeys.links(), [createBankLink(), createBankLink({ account_id: 'account-2' })]);
    authenticatedFetchMock.mockResolvedValue(createBankLink({ sync_in_progress: true }));
    const observer = new MutationObserver(queryClient, syncBankAccountMutationOptions(queryClient));

    // The request is held to the minimum time a pending button shows for, so the clock runs past it
    const synced = observer.mutate('account-1');
    await vi.runAllTimersAsync();
    await synced;

    const links = queryClient.getQueryData<BankLink[]>(bankSyncKeys.links());
    expect(authenticatedFetchMock).toHaveBeenCalledWith('/accounts/account-1/bank-link/sync', expect.objectContaining({ method: 'POST' }));
    expect(links?.map((link) => [link.account_id, link.sync_in_progress])).toEqual([['account-1', true], ['account-2', false]]);
    expect(getBankLinksPollInterval(links, null)).toBe(BANK_LINKS_ACTIVE_POLL_MS);
  });
});
