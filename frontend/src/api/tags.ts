import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryKey,
} from '@tanstack/react-query';
import { authenticatedFetch } from '@/api/client';
import { invalidateTags, invalidateTransactions } from '@/api/cacheInvalidation';
import { tagKeys } from '@/api/queryKeys';
import { buildQueryString, type QueryStringValue } from '@/api/queryString';
import { useAuth } from '@/hooks/useAuth';

export interface Tag {
  id: string;
  owner_id: string;
  group_id: string | null;
  name: string;
  created_at: string;
}

export interface TagFilters {
  group_id?: string;
  q?: string;
}

export interface CreateTagPayload {
  name: string;
  group_id?: string | null;
}

export interface UpdateTagPayload {
  name?: string;
}

export interface MergeTagPayload {
  replacement_tag_id: string;
}

/**
 * Checks whether a query key belongs to a paginated tag list
 */
function isTagInfiniteQueryKey(
  queryKey: QueryKey,
): queryKey is readonly ['tags', 'infinite', Record<string, unknown>, number] {
  return Array.isArray(queryKey) && queryKey[0] === 'tags' && queryKey[1] === 'infinite';
}

/**
 * Checks whether a tag belongs in a cached page for the active filters
 */
function tagMatchesFilters(tag: Tag, filters: Record<string, unknown>) {
  const groupId = typeof filters.group_id === 'string' ? filters.group_id : undefined;
  const q = typeof filters.q === 'string' ? filters.q.trim().toLowerCase() : '';

  const inScope = groupId
    ? tag.group_id === null || tag.group_id === groupId
    : tag.group_id === null;
  const matchesSearch = !q || tag.name.toLowerCase().includes(q);

  return inScope && matchesSearch;
}

/**
 * Inserts or replaces a tag while preserving existing infinite-query page sizes
 */
function upsertTagIntoInfiniteData(
  data: InfiniteData<Tag[]> | undefined,
  tag: Tag,
): InfiniteData<Tag[]> | undefined {
  if (!data) return data;

  if (data.pages.length === 0) {
    return {
      ...data,
      pages: [[tag]],
      pageParams: data.pageParams.length > 0 ? data.pageParams : [0],
    };
  }

  const pageLengths = data.pages.map((page) => page.length);
  const sortedTags = data.pages
    .flat()
    .filter((item) => item.id !== tag.id)
    .concat(tag)
    .sort((a, b) => a.name.localeCompare(b.name));
  let cursor = 0;

  // Existing page sizes keep scroll position and fetch boundaries stable after cache updates
  const pages = pageLengths.map((length) => {
    const page = sortedTags.slice(cursor, cursor + length);
    cursor += length;
    return page;
  });
  const remainingTags = sortedTags.slice(cursor);
  if (remainingTags.length > 0) {
    pages[pages.length - 1] = [...pages[pages.length - 1], ...remainingTags];
  }

  return { ...data, pages };
}

/**
 * Fetches one filtered tag page for settings and transaction tag selectors
 */
export function fetchTagsPage(filters: TagFilters = {}, pageSize = 20, offset = 0) {
  return authenticatedFetch<Tag[]>(
    '/tags' +
      buildQueryString({
        ...(filters as Record<string, QueryStringValue>),
        limit: pageSize,
        offset,
      }),
  );
}

export function useTag(tagId: string | null | undefined, enabled = true) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: tagKeys.detail(tagId),
    queryFn: () => authenticatedFetch<Tag>(`/tags/${tagId}`),
    enabled: !!accessToken && !!tagId && enabled,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useInfiniteTags(filters: TagFilters = {}, pageSize = 20, enabled = true) {
  const { accessToken } = useAuth();
  return useInfiniteQuery({
    queryKey: tagKeys.infinite(filters as Record<string, unknown>, pageSize),
    queryFn: ({ pageParam }) => fetchTagsPage(filters, pageSize, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < pageSize ? undefined : allPages.length * pageSize,
    enabled: !!accessToken && enabled,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateTagPayload) =>
      authenticatedFetch<Tag>('/tags', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (created) => {
      qc.setQueryData<Tag>(tagKeys.detail(created.id), created);
      qc.getQueryCache()
        .findAll({ queryKey: tagKeys.all, exact: false })
        .forEach((query) => {
          const queryKey = query.queryKey;
          if (!isTagInfiniteQueryKey(queryKey) || !tagMatchesFilters(created, queryKey[2])) return;

          qc.setQueryData<InfiniteData<Tag[]>>(
            queryKey,
            (data) => upsertTagIntoInfiniteData(data, created),
          );
        });
    },
  });
}

export function useUpdateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tagId, payload }: { tagId: string; payload: UpdateTagPayload }) =>
      authenticatedFetch<Tag>(`/tags/${tagId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: (updated) => {
      qc.setQueryData<Tag>(tagKeys.detail(updated.id), updated);
      invalidateTags(qc);
      invalidateTransactions(qc);
    },
  });
}

export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tagId: string) =>
      authenticatedFetch<void>(`/tags/${tagId}`, {
        method: 'DELETE',
      }),
    onSuccess: (_, tagId) => {
      qc.removeQueries({ queryKey: tagKeys.detail(tagId), exact: true });
      invalidateTags(qc);
      invalidateTransactions(qc);
    },
  });
}

export function useMergeTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tagId, payload }: { tagId: string; payload: MergeTagPayload }) =>
      authenticatedFetch<void>(`/tags/${tagId}/merge`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (_, { tagId }) => {
      qc.removeQueries({ queryKey: tagKeys.detail(tagId), exact: true });
      invalidateTags(qc);
      invalidateTransactions(qc);
    },
  });
}
