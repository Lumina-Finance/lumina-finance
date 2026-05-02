import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authenticatedFetch } from '@/api/client';
import { tagKeys } from '@/api/queryKeys';
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

function buildQueryString(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string | number] => entry[1] !== undefined,
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
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
      qc.invalidateQueries({ queryKey: tagKeys.all, exact: false });
    },
  });
}
