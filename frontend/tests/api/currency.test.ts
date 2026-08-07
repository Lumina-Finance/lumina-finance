/**
 * Covers currency API request functions used by money inputs and account forms
 *
 * These tests catch regressions where currency metadata requests call the wrong
 * endpoint or ignore backend load failures
 */
import { QueryClient, QueryObserver } from '@tanstack/react-query';
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
 * a failure that quietly returns to pending puts the whole app back on its loading screen. Every
 * navigation remounts the component holding this query, so that has to survive a remount
 */
describe('the currency query once it has failed', () => {
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

  it('fails rather than pausing while the browser reports itself offline', () => {
    // A paused query keeps its pending status and never settles, so the app would wait on it forever
    expect(currencyQueryOptions.networkMode).toBe('always');
  });
});
