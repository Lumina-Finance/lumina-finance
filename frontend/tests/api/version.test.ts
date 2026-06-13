/**
 * Covers app version API request functions used by update notices
 *
 * These tests catch regressions where version checks stop bypassing browser cache
 * or backend release URL fields are not mapped for the frontend
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE } from '@/api/config';
import { fetchAppVersion } from '@/api/version';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('version API functions', () => {
  it('requests app version metadata without browser caching', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        version: '1.2.3',
        update: {
          version: '1.2.4',
          release_url: 'https://example.com/releases/1.2.4',
        },
      }),
    });

    await expect(fetchAppVersion()).resolves.toEqual({
      version: '1.2.3',
      update: {
        version: '1.2.4',
        releaseUrl: 'https://example.com/releases/1.2.4',
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/version`, { cache: 'no-store' });
  });

  it('raises an error when version metadata fails to load', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
    });

    await expect(fetchAppVersion()).rejects.toThrow('Failed to load app version (503)');
  });
});
