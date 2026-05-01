import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
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

export interface MerchantFilters {
  group_id?: string;
  q?: string;
}

function buildQueryString(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string | number] => entry[1] !== undefined,
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

function invalidateMerchantMergeQueries(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: transactionKeys.all, exact: false });
  qc.invalidateQueries({ queryKey: transactionOverviewKeys.all, exact: false });
  qc.invalidateQueries({ queryKey: accountKeys.all, exact: false });
  qc.invalidateQueries({ queryKey: dashboardKeys.all, exact: false });
  qc.invalidateQueries({ queryKey: dashboardKeys.spendingComparisonAll, exact: false });
  qc.invalidateQueries({ queryKey: dashboardKeys.spendingBreakdownAll, exact: false });
}

export function useMerchant(merchantId: string | null | undefined, enabled = true) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: merchantKeys.detail(merchantId),
    queryFn: () => authenticatedFetch<Merchant>(`/merchants/${merchantId}`),
    enabled: !!accessToken && !!merchantId && enabled,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useInfiniteMerchants(filters: MerchantFilters = {}, pageSize = 20, enabled = true) {
  const { accessToken } = useAuth();
  return useInfiniteQuery({
    queryKey: merchantKeys.infinite(filters as Record<string, unknown>, pageSize),
    queryFn: ({ pageParam }) =>
      authenticatedFetch<Merchant[]>(
        '/merchants' +
          buildQueryString({
            ...(filters as Record<string, string | number | undefined>),
            limit: pageSize,
            offset: pageParam,
          }),
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < pageSize ? undefined : allPages.length * pageSize,
    enabled: !!accessToken && enabled,
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
    onSuccess: (created) => {
      qc.setQueryData<Merchant>(merchantKeys.detail(created.id), created);
      qc.invalidateQueries({ queryKey: merchantKeys.all, exact: false });
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
      qc.setQueryData<Merchant>(merchantKeys.detail(updated.id), updated);
      qc.invalidateQueries({ queryKey: merchantKeys.all, exact: false });
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
      qc.removeQueries({ queryKey: merchantKeys.detail(merchantId), exact: true });
      qc.invalidateQueries({ queryKey: merchantKeys.all, exact: false });
      invalidateMerchantMergeQueries(qc);
    },
  });
}
