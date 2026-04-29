import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { authenticatedFetch } from '@/api/client';
import { categoryKeys } from '@/api/queryKeys';

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
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) =>
      authenticatedFetch<void>(`/categories/${categoryId}`, {
        method: 'DELETE',
      }),
    onSuccess: (_, categoryId) => {
      queryClient.setQueryData<Category[]>(categoryKeys.list(), (categories) =>
        categories?.filter((category) => category.id !== categoryId) ?? categories,
      );
    },
  });
}
