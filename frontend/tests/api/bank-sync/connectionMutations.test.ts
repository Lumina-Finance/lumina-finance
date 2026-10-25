/**
 * Covers how the connection requests behave through the query cache the app runs on
 *
 * These tests catch a setup token waiting, with its form's Cancel held, for a connection the
 * browser says it lacks
 */
import { MutationObserver, onlineManager, QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import { claimSetupTokenMutationOptions, reconnectBankConnectionMutationOptions } from '@/api/bank-sync/hooks';

let queryClient: QueryClient;

beforeEach(() => {
  authenticatedFetchMock.mockReset();
  vi.useFakeTimers();
  queryClient = new QueryClient();
});

afterEach(() => {
  onlineManager.setOnline(true);
  queryClient.clear();
  vi.useRealTimers();
});

describe('a setup token sent while offline', () => {
  beforeEach(() => {
    onlineManager.setOnline(false);
    authenticatedFetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
  });

  it('fails at once for a claim rather than waiting for a connection', async () => {
    const observer = new MutationObserver(queryClient, claimSetupTokenMutationOptions(queryClient));

    const sent = observer.mutate({ provider: 'simplefin', setup_token: 'token' }).catch((error: unknown) => error);
    await vi.runAllTimersAsync();

    expect(observer.getCurrentResult()).toMatchObject({ status: 'error', isPaused: false });
    expect(await sent).toBeInstanceOf(TypeError);
  });

  it('fails at once for a reconnect rather than waiting for a connection', async () => {
    const observer = new MutationObserver(queryClient, reconnectBankConnectionMutationOptions(queryClient));

    const sent = observer.mutate({ connectionId: 'connection-1', setupToken: 'token' }).catch((error: unknown) => error);
    await vi.runAllTimersAsync();

    expect(observer.getCurrentResult()).toMatchObject({ status: 'error', isPaused: false });
    expect(await sent).toBeInstanceOf(TypeError);
  });
});
