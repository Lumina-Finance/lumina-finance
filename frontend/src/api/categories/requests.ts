import { authenticatedFetch } from '@/api/client';
import type {
  Category,
  CreateCategoryPayload,
  MergeCategoryRequest,
  UpdateCategoryRequest,
} from '@/api/categories/types';

/**
 * Fetches the full category list available to the current user
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchCategories(signal?: AbortSignal) {
  return authenticatedFetch<Category[]>('/categories', { signal });
}

/**
 * Creates a category for the requested kind and scope
 */
export function createCategory(payload: CreateCategoryPayload) {
  return authenticatedFetch<Category>('/categories', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Updates editable category fields
 */
export function updateCategory({ categoryId, payload }: UpdateCategoryRequest) {
  return authenticatedFetch<Category>(`/categories/${categoryId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/**
 * Deletes a category by ID
 */
export function deleteCategory(categoryId: string) {
  return authenticatedFetch<void>(`/categories/${categoryId}`, {
    method: 'DELETE',
  });
}

/**
 * Merges one category into a replacement category
 */
export function mergeCategory({ categoryId, payload }: MergeCategoryRequest) {
  return authenticatedFetch<void>(`/categories/${categoryId}/merge`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
