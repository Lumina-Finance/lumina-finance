/**
 * Covers paginated reference-data API functions used by selector hooks
 *
 * These tests catch regressions where tag or merchant filters,
 * page size, or offset are omitted from lookup endpoints
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import { fetchMerchantsPage } from '@/api/merchants';
import { fetchTagsPage } from '@/api/tags';

beforeEach(() => {
  authenticatedFetchMock.mockReset();
  authenticatedFetchMock.mockResolvedValue([]);
});

describe('reference lookup API functions', () => {
  it('requests paginated tags with default paging', async () => {
    await fetchTagsPage();

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/tags?limit=20&offset=0');
  });

  it('requests filtered tags with encoded search text', async () => {
    await fetchTagsPage({ group_id: 'group_123', q: 'tax credit' }, 50, 100);

    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      '/tags?group_id=group_123&q=tax+credit&limit=50&offset=100',
    );
  });

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
