import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  removeCategoryCaches,
  updateCategoryCreateCaches,
  updateCategoryUpdateCaches,
} from '@/api/cache/updates/categories';
import {
  createCategory,
  deleteCategory,
  fetchCategories,
  mergeCategory,
  updateCategory,
} from '@/api/categories/requests';
import { categoryKeys } from '@/api/cache/queryKeys';
import { useAuth } from '@/hooks/useAuth';

/**
 * Reads all categories available to the current user
 */
export function useCategories() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: categoryKeys.list(),
    queryFn: fetchCategories,
    enabled: !!accessToken,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/**
 * Creates categories and writes them into the sorted category list cache
 */
export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCategory,
    onSuccess: (category) => {
      updateCategoryCreateCaches(queryClient, category);
    },
  });
}

/**
 * Updates categories and refreshes data that may render category fields
 */
export function useUpdateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateCategory,
    onSuccess: (category) => {
      updateCategoryUpdateCaches(queryClient, category);
    },
  });
}

/**
 * Deletes categories and refreshes data that may reference the deleted category
 */
export function useDeleteCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteCategory,
    onSuccess: (_, categoryId) => {
      removeCategoryCaches(queryClient, categoryId);
    },
  });
}

/**
 * Merges categories and refreshes data that may reference the merged category
 */
export function useMergeCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: mergeCategory,
    onSuccess: (_, { categoryId }) => {
      removeCategoryCaches(queryClient, categoryId);
    },
  });
}
