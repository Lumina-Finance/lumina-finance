import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryKey,
} from '@tanstack/react-query';
import { authenticatedFetch } from '@/api/client';
import { tagKeys, transactionKeys } from '@/api/queryKeys';
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

function buildQueryString(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string | number] => entry[1] !== undefined,
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

function isTagInfiniteQueryKey(queryKey: QueryKey): queryKey is readonly ['tags', 'infinite', Record<string, unknown>, number] {
  return Array.isArray(queryKey) && queryKey[0] === 'tags' && queryKey[1] === 'infinite';
}

function tagMatchesFilters(tag: Tag, filters: Record<string, unknown>) {
  const groupId = typeof filters.group_id === 'string' ? filters.group_id : undefined;
  const q = typeof filters.q === 'string' ? filters.q.trim().toLowerCase() : '';

  const inScope = groupId
    ? tag.group_id === null || tag.group_id === groupId
    : tag.group_id === null;
  const matchesSearch = !q || tag.name.toLowerCase().includes(q);

  return inScope && matchesSearch;
}

function upsertTagIntoInfiniteData(data: InfiniteData<Tag[]> | undefined, tag: Tag): InfiniteData<Tag[]> | undefined {
  if (!data) return data;

  if (data.pages.length === 0) {
    return { ...data, pages: [[tag]], pageParams: data.pageParams.length > 0 ? data.pageParams : [0] };
  }

  const pageLengths = data.pages.map((page) => page.length);
  const sortedTags = data.pages
    .flat()
    .filter((item) => item.id !== tag.id)
    .concat(tag)
    .sort((a, b) => a.name.localeCompare(b.name));
  let cursor = 0;
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
    queryFn: ({ pageParam }) =>
      authenticatedFetch<Tag[]>(
        '/tags' +
          buildQueryString({
            ...(filters as Record<string, string | number | undefined>),
            limit: pageSize,
            offset: pageParam,
          }),
      ),
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
      qc.invalidateQueries({ queryKey: tagKeys.all, exact: false });
      qc.invalidateQueries({ queryKey: transactionKeys.all, exact: false });
    },
  });
}

export function useDeleteTag() {
  return useMutation({
    mutationFn: (tagId: string) =>
      authenticatedFetch<void>(`/tags/${tagId}`, {
        method: 'DELETE',
      }),
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
      qc.invalidateQueries({ queryKey: tagKeys.all, exact: false });
      qc.invalidateQueries({ queryKey: transactionKeys.all, exact: false });
    },
  });
}
