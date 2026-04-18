import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { authenticatedFetch } from '@/api/client';

export interface Category {
  id: string;
  group_id: string | null;
  owner_id: string;
  name: string;
  kind: 'expense' | 'income' | 'transfer';
  icon: string | null;
  created_at: string;
}

export function useCategories() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => authenticatedFetch<Category[]>('/categories'),
    enabled: !!accessToken,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
