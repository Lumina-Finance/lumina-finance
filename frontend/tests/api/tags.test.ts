/**
 * Covers tag API request functions used by settings and transaction selectors
 *
 * These tests catch regressions where tag detail, create, update, delete,
 * or merge operations call the wrong endpoint or send the wrong method payload
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import {
  createTag,
  deleteTag,
  fetchTag,
  mergeTag,
  updateTag,
} from '@/api/tags';

beforeEach(() => {
  authenticatedFetchMock.mockReset();
  authenticatedFetchMock.mockResolvedValue({});
});

describe('tag API functions', () => {
  it('requests tag detail records by ID', async () => {
    await fetchTag('tag_123');

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/tags/tag_123');
  });

  it('creates tags with group scope fields', async () => {
    await createTag({
      name: 'Quarterly',
      group_id: 'group_123',
    });

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/tags', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Quarterly',
        group_id: 'group_123',
      }),
    });
  });

  it('updates tag fields with a patch request', async () => {
    await updateTag({
      tagId: 'tag_123',
      payload: {
        name: 'Monthly',
      },
    });

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/tags/tag_123', {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'Monthly',
      }),
    });
  });

  it('deletes tag records by ID', async () => {
    await deleteTag('tag_123');

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/tags/tag_123', {
      method: 'DELETE',
    });
  });

  it('merges tags into a replacement tag', async () => {
    await mergeTag({
      tagId: 'tag_123',
      payload: {
        replacement_tag_id: 'tag_456',
      },
    });

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/tags/tag_123/merge', {
      method: 'POST',
      body: JSON.stringify({
        replacement_tag_id: 'tag_456',
      }),
    });
  });
});
