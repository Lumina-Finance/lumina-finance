/**
 * Covers app version API request functions used by update notices
 *
 * These tests catch regressions where version checks stop bypassing browser cache
 * or backend release URL fields are not mapped for the frontend
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE } from '@/api/config';
import { fetchAppVersion } from '@/api/version';
import { answerNever } from './fixtures';

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
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/version`, { cache: 'no-store', signal: expect.any(AbortSignal) });
  });

  it('raises an error when version metadata fails to load', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));

    await expect(fetchAppVersion()).rejects.toMatchObject({
      message: 'Oops, something went wrong. Please try again.',
      status: 503,
    });
  });
});

describe('a version check the page no longer needs', () => {
  it('stops when the load that asked for it is abandoned', async () => {
    fetchMock.mockImplementationOnce(answerNever);
    const load = new AbortController();

    const request = fetchAppVersion(undefined, load.signal);
    load.abort(new DOMException('Left the page', 'AbortError'));

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
});
