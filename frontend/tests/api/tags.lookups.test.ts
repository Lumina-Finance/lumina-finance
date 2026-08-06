/**
 * Covers the paginated tag lookup used by selector hooks
 *
 * These tests catch regressions where the tag filter, page size,
 * or offset are omitted from the lookup endpoint
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import { fetchTagsPage } from '@/api/tags';

beforeEach(() => {
  authenticatedFetchMock.mockReset();
  authenticatedFetchMock.mockResolvedValue([]);
});

describe('tag lookup API functions', () => {
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
});
