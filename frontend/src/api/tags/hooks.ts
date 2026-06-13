import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  removeTagCaches,
  updateTagCreateCaches,
  updateTagUpdateCaches,
} from '@/api/cache/updates/tags';
import {
  createTag,
  deleteTag,
  fetchTag,
  fetchTagsPage,
  mergeTag,
  updateTag,
} from '@/api/tags/requests';
import type { TagFilters } from '@/api/tags/types';
import { tagKeys } from '@/api/cache/queryKeys';
import { useAuth } from '@/hooks/useAuth';

/**
 * Reads a tag detail record when a tag ID is available
 */
export function useTag(tagId: string | null | undefined, enabled = true) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: tagKeys.detail(tagId),
    queryFn: () => fetchTag(tagId),
    enabled: !!accessToken && !!tagId && enabled,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/**
 * Reads paginated tags for settings and transaction tag selectors
 */
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

/**
 * Creates tags and writes them into matching lookup caches
 */
export function useCreateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTag,
    onSuccess: (tag) => {
      updateTagCreateCaches(queryClient, tag);
    },
  });
}

/**
 * Updates tags and refreshes cached tag usage
 */
export function useUpdateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateTag,
    onSuccess: (tag) => {
      updateTagUpdateCaches(queryClient, tag);
    },
  });
}

/**
 * Deletes tags and clears dependent tag usage data
 */
export function useDeleteTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteTag,
    onSuccess: (_, tagId) => {
      removeTagCaches(queryClient, tagId);
    },
  });
}

/**
 * Merges tags and clears dependent tag usage data
 */
export function useMergeTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: mergeTag,
    onSuccess: (_, { tagId }) => {
      removeTagCaches(queryClient, tagId);
    },
  });
}
