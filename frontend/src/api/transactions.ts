import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  useMutation,
  type InfiniteData,
} from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { authenticatedFetch } from '@/api/client';

// ── Types (mirror backend schemas) ──

export interface Transaction {
  id: string;
  created_by_user_id: string;
  account_id: string;
  ts: string;
  merchant_id: string | null;
  category_id: string;
  amount: number;
  currency: string;
  fx_rate: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  tag_ids: string[];
}

export interface TopCategorySpend {
  category_id: string;
  category_name: string;
  total: number;
}

export interface DailyCashFlow {
  date: string;
  inflow: number;
  outflow: number;
}

export interface OutlierTransaction {
  id: string;
  merchant_name: string | null;
  notes: string | null;
  amount: number;
  ts: string;
}

export interface TransactionsOverview {
  total_inflow: number | null;
  total_outflow: number | null;
  top_categories: TopCategorySpend[] | null;
  daily_cash_flow: DailyCashFlow[] | null;
  outliers: OutlierTransaction[] | null;
}

export interface TransactionFilters {
  account_id?: string;
  category_id?: string;
  merchant_id?: string;
  currency?: string;
  from_date?: string;
  to_date?: string;
  q?: string;
  sort_by?: 'ts' | 'amount' | 'created_at' | 'updated_at';
  sort_order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface OverviewFilters {
  from_date?: string;
  to_date?: string;
  account_id?: string;
}

export interface CreateTransactionPayload {
  account_id: string;
  ts: string;
  category_id: string;
  amount: number;
  currency: string;
  merchant_id?: string | null;
  fx_rate?: number | null;
  notes?: string | null;
  tag_ids?: string[];
}

export interface UpdateTransactionPayload {
  account_id?: string;
  ts?: string;
  category_id?: string;
  amount?: number;
  merchant_id?: string | null;
  fx_rate?: number | null;
  notes?: string | null;
  tag_ids?: string[];
}

// ── Helpers ──

function buildQueryString(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string | number] => entry[1] !== undefined,
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

// ── Hooks ──

export function useTransactions(filters: TransactionFilters = {}) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ['transactions', filters],
    queryFn: () =>
      authenticatedFetch<Transaction[]>(
        '/transactions' + buildQueryString(filters as Record<string, string | number | undefined>),
      ),
    enabled: !!accessToken,
    refetchOnWindowFocus: true,
    staleTime: 10 * 60 * 1000,
  });
}

export function useInfiniteTransactions(filters: Omit<TransactionFilters, 'limit' | 'offset'> = {}, pageSize = 15) {
  const { accessToken } = useAuth();
  return useInfiniteQuery({
    queryKey: ['transactions', 'infinite', filters, pageSize],
    queryFn: ({ pageParam }) =>
      authenticatedFetch<Transaction[]>(
        '/transactions' +
          buildQueryString({
            ...(filters as Record<string, string | number | undefined>),
            limit: pageSize,
            offset: pageParam,
          }),
      ),
    initialPageParam: 0,
    // A short page = end of data
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < pageSize ? undefined : allPages.length * pageSize,
    enabled: !!accessToken,
    refetchOnWindowFocus: true,
    staleTime: 10 * 60 * 1000,
  });
}

export function useTransactionsOverview(filters: OverviewFilters = {}) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ['transactions-overview', filters],
    queryFn: () =>
      authenticatedFetch<TransactionsOverview>(
        '/transactions/overview' + buildQueryString(filters as Record<string, string | number | undefined>),
      ),
    enabled: !!accessToken,
    refetchOnWindowFocus: true,
    staleTime: 10 * 60 * 1000,
  });
}

export function useCreateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateTransactionPayload) =>
      authenticatedFetch<Transaction>('/transactions', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['transactions-overview'] });
    },
  });
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateTransactionPayload }) =>
      authenticatedFetch<Transaction>(`/transactions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: (updated) => {
      // Patch the row in-place across cached lists instead of refetching them.
      // Infinite-query caches hold InfiniteData<Transaction[]>; the plain query holds Transaction[].
      queryClient.setQueriesData<InfiniteData<Transaction[]>>(
        { predicate: (q) => q.queryKey[0] === 'transactions' && q.queryKey[1] === 'infinite' },
        (old) =>
          old && {
            ...old,
            pages: old.pages.map((page) =>
              page.map((t) => (t.id === updated.id ? updated : t)),
            ),
          },
      );
      queryClient.setQueriesData<Transaction[]>(
        { predicate: (q) => q.queryKey[0] === 'transactions' && q.queryKey[1] !== 'infinite' },
        (old) => old?.map((t) => (t.id === updated.id ? updated : t)),
      );
      queryClient.invalidateQueries({ queryKey: ['transactions-overview'] });
    },
  });
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authenticatedFetch<void>(`/transactions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['transactions-overview'] });
    },
  });
}
