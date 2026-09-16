/**
 * Covers currency API request functions used by money inputs and account forms
 *
 * These tests catch regressions where currency metadata requests call the wrong
 * endpoint or ignore backend load failures
 */
import { QueryClient, QueryObserver, onlineManager } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE } from '@/api/config';
import { fetchCurrencies } from '@/api/currency';
import { currencyQueryOptions } from '@/api/currency/hooks';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('currency API functions', () => {
  it('requests the currency list endpoint', async () => {
    const currencies = [{
      id: 'CAD',
      name: 'Canadian dollar',
      symbol: '$',
      minor_unit_exponent: 2,
    }];

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => currencies,
    });

    await expect(fetchCurrencies()).resolves.toEqual(currencies);
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/currencies`,
      // Carries a timeout, so a request that hangs fails instead of leaving every form saying it is
      // still loading forever
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('raises an error when currencies fail to load', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    await expect(fetchCurrencies()).rejects.toThrow('Failed to load currencies (500)');
  });
});

/**
 * The app renders no screen until this query settles, and shows its recovery screen when it fails, so
 * a failure that quietly returns to pending puts the whole app back on its loading screen. Most
 * navigations remount the component holding this query, so that has to survive a remount
 */
describe('the currency query when it cannot load', () => {
  /** Subscribes an observer the way a mounting component does, and returns its unsubscribe */
  function mount(client: QueryClient) {
    const observer = new QueryObserver(client, currencyQueryOptions);
    return { observer, unsubscribe: observer.subscribe(() => {}) };
  }

  it('stays failed across a remount rather than fetching again', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const client = new QueryClient();

    const first = mount(client);
    await vi.waitFor(() => expect(first.observer.getCurrentResult().isError).toBe(true));
    first.unsubscribe();

    const second = mount(client);
    const result = second.observer.getCurrentResult();
    second.unsubscribe();

    expect(result.isError).toBe(true);
    expect(result.isPending).toBe(false);
    // One call for the whole sequence: no retry on the failure, and none on the remount either
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails rather than pausing while the browser reports itself offline', async () => {
    // A paused query keeps its pending status and never settles, so the app would hold its loading
    // screen forever rather than reaching the recovery screen that offers a way out
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    onlineManager.setOnline(false);

    try {
      const client = new QueryClient();
      const { observer, unsubscribe } = mount(client);
      await vi.waitFor(() => expect(observer.getCurrentResult().isError).toBe(true));
      expect(observer.getCurrentResult().fetchStatus).not.toBe('paused');
      unsubscribe();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('recovers on explicit retry without another automatic request', async () => {
    const currencies = [{ id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 }];
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const client = new QueryClient();
    const { observer, unsubscribe } = mount(client);

    try {
      await vi.waitFor(() => expect(observer.getCurrentResult().isError).toBe(true));
      let finishRetry!: (response: Response) => void;
      fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { finishRetry = resolve; }));

      const retry = observer.refetch();
      expect(observer.getCurrentResult().isFetching).toBe(true);
      const repeatedRetry = observer.refetch();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      finishRetry(new Response(JSON.stringify(currencies)));
      await Promise.all([retry, repeatedRetry]);

      expect(observer.getCurrentResult().data).toEqual(currencies);
      expect(observer.getCurrentResult().error).toBeNull();
      expect(observer.getCurrentResult().isFetching).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
      client.clear();
      vi.unstubAllGlobals();
    }
  });

  it('settles a failed explicit retry and allows a later successful retry', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    const client = new QueryClient();
    const { observer, unsubscribe } = mount(client);

    try {
      await vi.waitFor(() => expect(observer.getCurrentResult().isError).toBe(true));
      await observer.refetch();
      expect(observer.getCurrentResult().isError).toBe(true);
      expect(observer.getCurrentResult().isFetching).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'CAD' }])));
      await observer.refetch();
      expect(observer.getCurrentResult().isSuccess).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      unsubscribe();
      client.clear();
      vi.unstubAllGlobals();
    }
  });
});


describe('retrying an incomplete currency list', () => {
  it('refetches a successful cached list and restores a missing currency for all observers', async () => {
    const usd = { id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 };
    const cad = { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 };
    const client = new QueryClient();
    client.setQueryData(currencyQueryOptions.queryKey, [usd]);
    const field = new QueryObserver(client, currencyQueryOptions);
    const tooltip = new QueryObserver(client, currencyQueryOptions);
    const unsubField = field.subscribe(() => {});
    const unsubTooltip = tooltip.subscribe(() => {});

    try {
      expect(fetchMock).not.toHaveBeenCalled();
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
      await tooltip.refetch({ cancelRefetch: false });
      expect(field.getCurrentResult().data).toEqual([usd]);
      // ProtectedRoute uses this flag so failed refreshes do not unmount the edited form
      expect(field.getCurrentResult().isLoadingError).toBe(false);
      expect(field.getCurrentResult().isRefetchError).toBe(true);

      let finish!: (response: Response) => void;
      fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }));
      const retry = tooltip.refetch({ cancelRefetch: false });
      const repeatedRetry = field.refetch({ cancelRefetch: false });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      finish(new Response(JSON.stringify([usd, cad])));
      await Promise.all([retry, repeatedRetry]);
      expect(field.getCurrentResult().data).toEqual([usd, cad]);
      expect(tooltip.getCurrentResult().data).toEqual([usd, cad]);
      expect(field.getCurrentResult().error).toBeNull();
    } finally {
      unsubField();
      unsubTooltip();
      client.clear();
      vi.unstubAllGlobals();
    }
  });
});
