import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { authenticatedFetch } from '@/api/client';
import {
  accountKeys,
  budgetKeys,
  categoryKeys,
  dashboardKeys,
  merchantKeys,
  transactionKeys,
  transactionOverviewKeys,
} from '@/api/queryKeys';

export interface Category {
  id: string;
  group_id: string | null;
  owner_id: string | null;
  name: string;
  kind: 'expense' | 'income' | 'transfer';
  icon: string | null;
  is_system: boolean;
  created_at: string;
}

export interface UpdateCategoryPayload {
  name?: string;
  icon?: string | null;
}

export interface CreateCategoryPayload {
  name: string;
  kind: Category['kind'];
  icon?: string | null;
  group_id?: string | null;
}

export interface MergeCategoryPayload {
  replacement_category_id: string;
}

function invalidateCategoryMergeQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: transactionKeys.all, exact: false });
  queryClient.invalidateQueries({ queryKey: transactionOverviewKeys.all, exact: false });
  queryClient.invalidateQueries({ queryKey: accountKeys.all, exact: false });
  queryClient.invalidateQueries({ queryKey: dashboardKeys.all, exact: false });
  queryClient.invalidateQueries({ queryKey: dashboardKeys.spendingComparisonAll, exact: false });
  queryClient.invalidateQueries({ queryKey: dashboardKeys.spendingBreakdownAll, exact: false });
  queryClient.invalidateQueries({ queryKey: budgetKeys.all, exact: false });
  queryClient.invalidateQueries({ queryKey: merchantKeys.all, exact: false });
}

export function useCategories() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: categoryKeys.list(),
    queryFn: () => authenticatedFetch<Category[]>('/categories'),
    enabled: !!accessToken,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateCategoryPayload) =>
      authenticatedFetch<Category>('/categories', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (createdCategory) => {
      queryClient.setQueryData<Category[]>(categoryKeys.list(), (categories) =>
        [...(categories ?? []), createdCategory].sort((a, b) => a.name.localeCompare(b.name)),
      );
    },
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, payload }: { categoryId: string; payload: UpdateCategoryPayload }) =>
      authenticatedFetch<Category>(`/categories/${categoryId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: (updatedCategory) => {
      queryClient.setQueryData<Category[]>(categoryKeys.list(), (categories) =>
        categories?.map((category) => (
          category.id === updatedCategory.id ? updatedCategory : category
        )) ?? categories,
      );
    },
  });
}

export function useDeleteCategory() {
  return useMutation({
    mutationFn: (categoryId: string) =>
      authenticatedFetch<void>(`/categories/${categoryId}`, {
        method: 'DELETE',
      }),
  });
}

export function useMergeCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, payload }: { categoryId: string; payload: MergeCategoryPayload }) =>
      authenticatedFetch<void>(`/categories/${categoryId}/merge`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (_, { categoryId }) => {
      queryClient.setQueryData<Category[]>(categoryKeys.list(), (categories) =>
        categories?.filter((category) => category.id !== categoryId) ?? categories,
      );
      invalidateCategoryMergeQueries(queryClient);
    },
  });
}
