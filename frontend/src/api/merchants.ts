import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { authenticatedFetch } from '@/api/client';
import {
  accountKeys,
  dashboardKeys,
  merchantKeys,
  transactionKeys,
  transactionOverviewKeys,
} from '@/api/queryKeys';

export interface Merchant {
  id: string;
  owner_id: string;
  group_id: string | null;
  name: string;
  default_category_id: string | null;
  created_at: string;
}

export interface CreateMerchantPayload {
  name: string;
  default_category_id?: string | null;
  group_id?: string | null;
}

export interface UpdateMerchantPayload {
  name?: string;
  default_category_id?: string | null;
}

export interface MergeMerchantPayload {
  replacement_merchant_id: string;
}

function invalidateMerchantMergeQueries(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: transactionKeys.all, exact: false });
  qc.invalidateQueries({ queryKey: transactionOverviewKeys.all, exact: false });
  qc.invalidateQueries({ queryKey: accountKeys.all, exact: false });
  qc.invalidateQueries({ queryKey: dashboardKeys.all, exact: false });
  qc.invalidateQueries({ queryKey: dashboardKeys.spendingComparisonAll, exact: false });
  qc.invalidateQueries({ queryKey: dashboardKeys.spendingBreakdownAll, exact: false });
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
    mutationFn: (payload: CreateMerchantPayload) =>
      authenticatedFetch<Merchant>('/merchants', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    // Splice the new merchant into the cache so the dropdown sees it immediately
    onSuccess: (created) => {
      qc.setQueryData<Merchant[]>(merchantKeys.list(), (prev = []) =>
        [...prev, created].sort((a, b) => a.name.localeCompare(b.name)),
      );
    },
  });
}

export function useUpdateMerchant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ merchantId, payload }: { merchantId: string; payload: UpdateMerchantPayload }) =>
      authenticatedFetch<Merchant>(`/merchants/${merchantId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: (updated) => {
      qc.setQueryData<Merchant[]>(merchantKeys.list(), (prev) =>
        prev
          ?.map((merchant) => (merchant.id === updated.id ? updated : merchant))
          .sort((a, b) => a.name.localeCompare(b.name)) ?? prev,
      );
    },
  });
}

export function useDeleteMerchant() {
  return useMutation({
    mutationFn: (merchantId: string) =>
      authenticatedFetch<void>(`/merchants/${merchantId}`, {
        method: 'DELETE',
      }),
  });
}

export function useMergeMerchant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ merchantId, payload }: { merchantId: string; payload: MergeMerchantPayload }) =>
      authenticatedFetch<void>(`/merchants/${merchantId}/merge`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (_, { merchantId }) => {
      qc.setQueryData<Merchant[]>(merchantKeys.list(), (merchants) =>
        merchants?.filter((merchant) => merchant.id !== merchantId) ?? merchants,
      );
      invalidateMerchantMergeQueries(qc);
    },
  });
}
