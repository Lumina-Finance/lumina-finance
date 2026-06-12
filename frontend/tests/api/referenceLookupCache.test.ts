/**
 * Covers shared cache helpers for paginated merchant and tag lookups
 *
 * These tests catch regressions where group filters, search filters, page sizes,
 * or removal logic would make cached selector results drift from the backend scope
 */
import { describe, expect, it } from 'vitest';
import type { InfiniteData } from '@tanstack/react-query';
import {
  referenceLookupMatchesFilters,
  removeReferenceLookupFromInfiniteData,
  upsertReferenceLookupIntoInfiniteData,
} from '@/api/referenceLookupCache';

interface TestLookupItem {
  id: string;
  group_id: string | null;
  name: string;
}

const sharedItem: TestLookupItem = {
  id: 'shared',
  group_id: null,
  name: 'Shared Market',
};

const groupItem: TestLookupItem = {
  id: 'group',
  group_id: 'group_123',
  name: 'Group Market',
};

describe('reference lookup cache helpers', () => {
  it('keeps shared items visible to group filters but hides group items globally', () => {
    expect(referenceLookupMatchesFilters(sharedItem, { group_id: 'group_123' })).toBe(true);
    expect(referenceLookupMatchesFilters(groupItem, {})).toBe(false);
  });

  it('matches lookup items against trimmed search text', () => {
    expect(referenceLookupMatchesFilters(groupItem, {
      group_id: 'group_123',
      q: ' market ',
    })).toBe(true);
    expect(referenceLookupMatchesFilters(groupItem, {
      group_id: 'group_123',
      q: 'rent',
    })).toBe(false);
  });

  it('upserts sorted lookup items without changing existing page sizes', () => {
    const data: InfiniteData<TestLookupItem[]> = {
      pages: [
        [{ id: 'beta', group_id: null, name: 'Beta' }],
        [{ id: 'delta', group_id: null, name: 'Delta' }],
      ],
      pageParams: [0, 1],
    };

    const updated = upsertReferenceLookupIntoInfiniteData(data, {
      id: 'alpha',
      group_id: null,
      name: 'Alpha',
    });

    expect(updated?.pages).toEqual([
      [{ id: 'alpha', group_id: null, name: 'Alpha' }],
      [
        { id: 'beta', group_id: null, name: 'Beta' },
        { id: 'delta', group_id: null, name: 'Delta' },
      ],
    ]);
  });

  it('removes lookup items from every cached page', () => {
    const data: InfiniteData<TestLookupItem[]> = {
      pages: [
        [{ id: 'alpha', group_id: null, name: 'Alpha' }],
        [{ id: 'beta', group_id: null, name: 'Beta' }],
      ],
      pageParams: [0, 1],
    };

    expect(removeReferenceLookupFromInfiniteData(data, 'alpha')?.pages).toEqual([
      [],
      [{ id: 'beta', group_id: null, name: 'Beta' }],
    ]);
  });
});
