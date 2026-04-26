import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { authenticatedFetch } from '@/api/client';
import { merchantKeys } from '@/api/queryKeys';

export interface Merchant {
  id: string;
  owner_id: string;
  group_id: string | null;
  name: string;
  default_category_id: string | null;
  created_at: string;
}

export function useMerchants() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: merchantKeys.list(),
    queryFn: () => authenticatedFetch<Merchant[]>('/merchants'),
    enabled: !!accessToken,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useCreateMerchant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; default_category_id?: string | null }) =>
      authenticatedFetch<Merchant>('/merchants', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    // Splice the new merchant into the cache so the dropdown sees it immediately
    onSuccess: (created) => {
      qc.setQueryData<Merchant[]>(merchantKeys.list(), (prev = []) => [...prev, created]);
    },
  });
}
