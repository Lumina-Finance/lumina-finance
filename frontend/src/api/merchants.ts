import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
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

function isMerchantInfiniteQueryKey(
  queryKey: QueryKey,
): queryKey is readonly ['merchants', 'infinite', Record<string, unknown>, number] {
  return Array.isArray(queryKey) && queryKey[0] === 'merchants' && queryKey[1] === 'infinite';
}

function merchantMatchesFilters(merchant: Merchant, filters: Record<string, unknown>) {
  const groupId = typeof filters.group_id === 'string' ? filters.group_id : undefined;
  const q = typeof filters.q === 'string' ? filters.q.trim().toLowerCase() : '';

  const inScope = groupId
    ? merchant.group_id === null || merchant.group_id === groupId
    : merchant.group_id === null;
  const matchesSearch = !q || merchant.name.toLowerCase().includes(q);

  return inScope && matchesSearch;
}

function upsertMerchantIntoInfiniteData(
  data: InfiniteData<Merchant[]> | undefined,
  merchant: Merchant,
): InfiniteData<Merchant[]> | undefined {
  if (!data) return data;

  if (data.pages.length === 0) {
    return { ...data, pages: [[merchant]], pageParams: data.pageParams.length > 0 ? data.pageParams : [0] };
  }

  const pageLengths = data.pages.map((page) => page.length);
  const sortedMerchants = data.pages
    .flat()
    .filter((item) => item.id !== merchant.id)
    .concat(merchant)
    .sort((a, b) => a.name.localeCompare(b.name));
  let cursor = 0;
  const pages = pageLengths.map((length) => {
    const page = sortedMerchants.slice(cursor, cursor + length);
    cursor += length;
    return page;
  });
  const remainingMerchants = sortedMerchants.slice(cursor);
  if (remainingMerchants.length > 0) {
    pages[pages.length - 1] = [...pages[pages.length - 1], ...remainingMerchants];
  }

  return { ...data, pages };
}

function removeMerchantFromInfiniteData(
  data: InfiniteData<Merchant[]> | undefined,
  merchantId: string,
): InfiniteData<Merchant[]> | undefined {
  if (!data) return data;

  return {
    ...data,
    pages: data.pages.map((page) => page.filter((merchant) => merchant.id !== merchantId)),
  };
}

function invalidateMerchantMergeQueries(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: transactionKeys.all, exact: false });
  qc.invalidateQueries({ queryKey: transactionOverviewKeys.all, exact: false });
  qc.invalidateQueries({ queryKey: accountKeys.all, exact: false });
  qc.invalidateQueries({ queryKey: dashboardKeys.recentActivityAll, exact: false });
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
      qc.getQueryCache()
        .findAll({ queryKey: merchantKeys.all, exact: false })
        .forEach((query) => {
          const queryKey = query.queryKey;
          if (!isMerchantInfiniteQueryKey(queryKey) || !merchantMatchesFilters(created, queryKey[2])) return;

          qc.setQueryData<InfiniteData<Merchant[]>>(
            queryKey,
            (data) => upsertMerchantIntoInfiniteData(data, created),
          );
        });
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
      qc.getQueryCache()
        .findAll({ queryKey: merchantKeys.all, exact: false })
        .forEach((query) => {
          const queryKey = query.queryKey;
          if (!isMerchantInfiniteQueryKey(queryKey)) return;

          qc.setQueryData<InfiniteData<Merchant[]>>(
            queryKey,
            (data) => merchantMatchesFilters(updated, queryKey[2])
              ? upsertMerchantIntoInfiniteData(data, updated)
              : removeMerchantFromInfiniteData(data, updated.id),
          );
        });
      qc.invalidateQueries({ queryKey: merchantKeys.all, exact: false });
      qc.invalidateQueries({ queryKey: dashboardKeys.recentActivityAll, exact: false });
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
