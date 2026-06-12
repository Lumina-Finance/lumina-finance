/**
 * Covers category API request functions used by settings and transaction forms
 *
 * These tests catch regressions where category list, create, update, delete,
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
  createCategory,
  deleteCategory,
  fetchCategories,
  mergeCategory,
  updateCategory,
} from '@/api/categories';

beforeEach(() => {
  authenticatedFetchMock.mockReset();
  authenticatedFetchMock.mockResolvedValue({});
});

describe('category API functions', () => {
  it('requests the full category list', async () => {
    await fetchCategories();

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/categories');
  });

  it('creates categories with kind and group scope fields', async () => {
    await createCategory({
      name: 'Groceries',
      kind: 'expense',
      icon: 'basket',
      group_id: 'group_123',
    });

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/categories', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Groceries',
        kind: 'expense',
        icon: 'basket',
        group_id: 'group_123',
      }),
    });
  });

  it('updates category fields with a patch request', async () => {
    await updateCategory({
      categoryId: 'cat_123',
      payload: {
        name: 'Food',
        icon: null,
      },
    });

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/categories/cat_123', {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'Food',
        icon: null,
      }),
    });
  });

  it('deletes category records by ID', async () => {
    await deleteCategory('cat_123');

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/categories/cat_123', {
      method: 'DELETE',
    });
  });

  it('merges categories into a replacement category', async () => {
    await mergeCategory({
      categoryId: 'cat_123',
      payload: {
        replacement_category_id: 'cat_456',
      },
    });

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/categories/cat_123/merge', {
      method: 'POST',
      body: JSON.stringify({
        replacement_category_id: 'cat_456',
      }),
    });
  });
});
