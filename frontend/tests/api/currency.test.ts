/**
 * Covers currency API request functions used by money inputs and account forms
 *
 * These tests catch regressions where currency metadata requests call the wrong
 * endpoint or ignore backend load failures
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE } from '@/api/config';
import { fetchCurrencies } from '@/api/currency';

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
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/currencies`);
  });

  it('raises an error when currencies fail to load', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    await expect(fetchCurrencies()).rejects.toThrow('Failed to load currencies (500)');
  });
});
