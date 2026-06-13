import { authenticatedFetch } from '@/api/client';
import { buildQueryString, type QueryStringValue } from '@/api/utils/queryString';
import type {
  CreateTagPayload,
  MergeTagRequest,
  Tag,
  TagFilters,
  UpdateTagRequest,
} from '@/api/tags/types';

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

/**
 * Fetches a tag detail record by ID
 */
export function fetchTag(tagId: string | null | undefined) {
  return authenticatedFetch<Tag>(`/tags/${tagId}`);
}

/**
 * Creates a tag reference record
 */
export function createTag(payload: CreateTagPayload) {
  return authenticatedFetch<Tag>('/tags', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Updates editable tag fields
 */
export function updateTag({ tagId, payload }: UpdateTagRequest) {
  return authenticatedFetch<Tag>(`/tags/${tagId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/**
 * Deletes a tag reference record
 */
export function deleteTag(tagId: string) {
  return authenticatedFetch<void>(`/tags/${tagId}`, {
    method: 'DELETE',
  });
}

/**
 * Merges one tag into a replacement tag
 */
export function mergeTag({ tagId, payload }: MergeTagRequest) {
  return authenticatedFetch<void>(`/tags/${tagId}/merge`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
