import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { invalidateTags, invalidateTransactions } from '@/api/cache/invalidation';
import { tagKeys } from '@/api/cache/queryKeys';
import {
  isInfiniteReferenceLookupQueryKey,
  referenceLookupMatchesFilters,
  upsertReferenceLookupIntoInfiniteData,
} from '@/api/cache/referenceLookup';
import type { Tag } from '@/api/tags/types';

/**
 * Invalidates views whose rendered transaction metadata depends on tags
 */
function invalidateTagUsageQueries(queryClient: QueryClient) {
  invalidateTags(queryClient);
  invalidateTransactions(queryClient);
}

/**
 * Writes a newly created tag into detail and matching lookup caches
 */
export function updateTagCreateCaches(queryClient: QueryClient, tag: Tag) {
  queryClient.setQueryData<Tag>(tagKeys.detail(tag.id), tag);
  queryClient.getQueryCache()
    .findAll({ queryKey: tagKeys.all, exact: false })
    .forEach((query) => {
      const queryKey = query.queryKey;
      if (
        !isInfiniteReferenceLookupQueryKey(queryKey, 'tags') ||
        !referenceLookupMatchesFilters(tag, queryKey[2])
      ) return;

      queryClient.setQueryData<InfiniteData<Tag[]>>(
        queryKey,
        (data) => upsertReferenceLookupIntoInfiniteData(data, tag),
      );
    });
}

/**
 * Updates tag detail data and invalidates cached tag usage
 */
export function updateTagUpdateCaches(queryClient: QueryClient, tag: Tag) {
  queryClient.setQueryData<Tag>(tagKeys.detail(tag.id), tag);
  invalidateTagUsageQueries(queryClient);
}

/**
 * Removes stale tag detail data and invalidates cached tag usage
 */
export function removeTagCaches(queryClient: QueryClient, tagId: string) {
  queryClient.removeQueries({ queryKey: tagKeys.detail(tagId), exact: true });
  invalidateTagUsageQueries(queryClient);
}
