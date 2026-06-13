import { authenticatedFetch } from '@/api/client';
import type {
  Category,
  CreateCategoryPayload,
  MergeCategoryRequest,
  UpdateCategoryRequest,
} from '@/api/categories/types';

/**
 * Fetches the full category list available to the current user
 */
export function fetchCategories() {
  return authenticatedFetch<Category[]>('/categories');
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
