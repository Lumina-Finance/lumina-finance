import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { runWithMinimumPendingTime } from '@/api/utils/mutationFeedback';
import { taxAdvantagedCategoryKeys } from '@/api/queryKeys';
import {
  refreshTaxAdvantagedCategoryLimitCaches,
  refreshTaxAdvantagedCategorySummary,
  removeTaxAdvantagedCategoryCaches,
  removeTaxAdvantagedCategoryLimit,
  updateTaxAdvantagedCategoryCaches,
  upsertTaxAdvantagedCategoryLimit,
} from '@/api/taxAdvantagedCategories/cache';
import {
  createTaxAdvantagedCategory,
  createTaxAdvantagedCategoryLimit,
  deleteTaxAdvantagedCategory,
  deleteTaxAdvantagedCategoryLimit,
  fetchTaxAdvantagedCategories,
  fetchTaxAdvantagedCategory,
  fetchTaxAdvantagedCategoryLimits,
  updateTaxAdvantagedCategory,
  updateTaxAdvantagedCategoryLimit,
} from '@/api/taxAdvantagedCategories/requests';
import type {
  UpdateTaxAdvantagedCategoryPayload,
} from '@/api/taxAdvantagedCategories/types';
import { useAuth } from '@/hooks/useAuth';

/**
 * Reads tax-advantaged category summaries
 */
export function useTaxAdvantagedCategories() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: taxAdvantagedCategoryKeys.list(),
    queryFn: fetchTaxAdvantagedCategories,
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Creates tax-advantaged categories and updates cached category summaries
 */
export function useCreateTaxAdvantagedCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTaxAdvantagedCategory,
    onSuccess: (category) => {
      updateTaxAdvantagedCategoryCaches(queryClient, category);
    },
  });
}

/**
 * Updates one tax-advantaged category and refreshes cached category summaries
 */
export function useUpdateTaxAdvantagedCategory(categoryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateTaxAdvantagedCategoryPayload) =>
      updateTaxAdvantagedCategory(categoryId, payload),
    onSuccess: (category) => {
      updateTaxAdvantagedCategoryCaches(queryClient, category);
    },
  });
}

/**
 * Deletes tax-advantaged categories and clears linked account caches
 */
export function useDeleteTaxAdvantagedCategory({ minimumPendingMs = 0 }: { minimumPendingMs?: number } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) =>
      runWithMinimumPendingTime(minimumPendingMs, () =>
        deleteTaxAdvantagedCategory(categoryId),
      ),
    onSuccess: (_data, categoryId) => {
      removeTaxAdvantagedCategoryCaches(queryClient, categoryId);
    },
  });
}

/**
 * Reads yearly limits for one tax-advantaged category
 */
export function useTaxAdvantagedCategoryLimits(categoryId: string | undefined) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: taxAdvantagedCategoryKeys.limits(categoryId),
    queryFn: () => fetchTaxAdvantagedCategoryLimits(categoryId),
    enabled: !!accessToken && !!categoryId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Creates yearly limits and refreshes contribution rollups
 */
export function useCreateTaxAdvantagedCategoryLimit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTaxAdvantagedCategoryLimit,
    onSuccess: (limit, variables) => {
      upsertTaxAdvantagedCategoryLimit(queryClient, limit);
      refreshTaxAdvantagedCategorySummary(queryClient, variables.categoryId);
    },
  });
}

/**
 * Updates yearly limits and refreshes contribution rollups
 */
export function useUpdateTaxAdvantagedCategoryLimit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateTaxAdvantagedCategoryLimit,
    onSuccess: (limit, variables) => {
      upsertTaxAdvantagedCategoryLimit(queryClient, limit);
      refreshTaxAdvantagedCategorySummary(queryClient, variables.categoryId);
    },
  });
}

/**
 * Deletes yearly limits and refreshes contribution rollups
 */
export function useDeleteTaxAdvantagedCategoryLimit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteTaxAdvantagedCategoryLimit,
    onSuccess: (_data, variables) => {
      removeTaxAdvantagedCategoryLimit(queryClient, variables.categoryId, variables.year);
      refreshTaxAdvantagedCategoryLimitCaches(queryClient, variables.categoryId);
    },
  });
}

/**
 * Reads one tax-advantaged category by ID
 */
export function useTaxAdvantagedCategory(categoryId: string | null | undefined) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: taxAdvantagedCategoryKeys.detail(categoryId),
    queryFn: () => fetchTaxAdvantagedCategory(categoryId),
    enabled: !!accessToken && !!categoryId,
    staleTime: 5 * 60 * 1000,
  });
}
