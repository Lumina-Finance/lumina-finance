import type { InfiniteData, QueryKey } from '@tanstack/react-query';

export type InfiniteReferenceLookupQueryKey = readonly [
  string,
  'infinite',
  Record<string, unknown>,
  number,
];

interface ReferenceLookupItem {
  id: string;
  group_id: string | null;
  name: string;
}

/**
 * Checks whether a query key belongs to a paginated reference lookup list
 */
export function isInfiniteReferenceLookupQueryKey(
  queryKey: QueryKey,
  resourceName: string,
): queryKey is InfiniteReferenceLookupQueryKey {
  return Array.isArray(queryKey) && queryKey[0] === resourceName && queryKey[1] === 'infinite';
}

/**
 * Checks whether a shared or group-owned lookup item belongs in a filtered page
 */
export function referenceLookupMatchesFilters(
  item: ReferenceLookupItem,
  filters: Record<string, unknown>,
) {
  const groupId = typeof filters.group_id === 'string' ? filters.group_id : undefined;
  const searchText = typeof filters.q === 'string' ? filters.q.trim().toLowerCase() : '';

  const inScope = groupId
    ? item.group_id === null || item.group_id === groupId
    : item.group_id === null;
  const matchesSearch = !searchText || item.name.toLowerCase().includes(searchText);

  return inScope && matchesSearch;
}

/**
 * Inserts or replaces a lookup item while preserving existing infinite-query page sizes
 */
export function upsertReferenceLookupIntoInfiniteData<TItem extends ReferenceLookupItem>(
  data: InfiniteData<TItem[]> | undefined,
  item: TItem,
): InfiniteData<TItem[]> | undefined {
  if (!data) return data;

  if (data.pages.length === 0) {
    return {
      ...data,
      pages: [[item]],
      pageParams: data.pageParams.length > 0 ? data.pageParams : [0],
    };
  }

  const pageLengths = data.pages.map((page) => page.length);
  const sortedItems = data.pages
    .flat()
    .filter((currentItem) => currentItem.id !== item.id)
    .concat(item)
    .sort((a, b) => a.name.localeCompare(b.name));
  let cursor = 0;

  // Existing page sizes keep scroll position and fetch boundaries stable after cache updates
  const pages = pageLengths.map((length) => {
    const page = sortedItems.slice(cursor, cursor + length);
    cursor += length;
    return page;
  });
  const remainingItems = sortedItems.slice(cursor);
  if (remainingItems.length > 0) {
    pages[pages.length - 1] = [...pages[pages.length - 1], ...remainingItems];
  }

  return { ...data, pages };
}

/**
 * Removes a lookup item from every cached infinite-query page
 */
export function removeReferenceLookupFromInfiniteData<TItem extends { id: string }>(
  data: InfiniteData<TItem[]> | undefined,
  itemId: string,
): InfiniteData<TItem[]> | undefined {
  if (!data) return data;

  return {
    ...data,
    pages: data.pages.map((page) => page.filter((item) => item.id !== itemId)),
  };
}
