/**
 * Covers the paginated merchant lookup used by selector hooks
 *
 * These tests catch regressions where the merchant filter, page size,
 * or offset are omitted from the lookup endpoint
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import { fetchMerchantsPage } from '@/api/merchants';

beforeEach(() => {
  authenticatedFetchMock.mockReset();
  authenticatedFetchMock.mockResolvedValue([]);
});

describe('merchant lookup API functions', () => {
  it('requests paginated merchants with default paging', async () => {
    await fetchMerchantsPage();

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/merchants?limit=20&offset=0');
  });

  it('requests filtered merchants with encoded search text', async () => {
    await fetchMerchantsPage({ group_id: 'group_123', q: 'coffee shop' }, 25, 75);

    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      '/merchants?group_id=group_123&q=coffee+shop&limit=25&offset=75',
    );
  });
});
