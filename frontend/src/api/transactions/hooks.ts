import { useCallback } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  invalidateInsightsMerchants,
  invalidateTransactions,
  invalidateTransactionOverview,
} from '@/api/cache/invalidation';
import { runWithMinimumPendingTime } from '@/api/utils/mutationFeedback';
import { transactionKeys, transactionOverviewKeys } from '@/api/cache/queryKeys';
import {
  findCachedTransaction,
  invalidateFinancialTransactionData,
  invalidatePatchedTransactionData,
  invalidateTransactionAccountData,
  removeTransactionFromLists,
  uniqueIds,
} from '@/api/cache/updates/transactions';
import {
  createTransaction,
  deleteTransaction,
  fetchTransaction,
  fetchTransactionPage,
  fetchTransactions,
  fetchTransactionsOverview,
  updateTransaction,
} from '@/api/transactions/requests';
import type {
  OverviewFilters,
  TransactionFilters,
  UpdateTransactionPayload,
} from '@/api/transactions/types';
import { getFxAwareStaleTime } from '@/api/shared/fxCache';
import { useAuth } from '@/hooks/useAuth';

const TRANSACTION_OVERVIEW_FX_STALE_TIME_MS = 10 * 60 * 1000;

/**
 * Reads transactions for non-infinite consumers such as selectors
 */
export function useTransactions(filters: TransactionFilters = {}) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: transactionKeys.list(filters as Record<string, unknown>),
    queryFn: () => fetchTransactions(filters),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Reads transaction list pages for the transactions screen
 */
export function useInfiniteTransactions(
  filters: Omit<TransactionFilters, 'limit' | 'offset'> = {},
  pageSize = 15,
) {
  const { accessToken } = useAuth();
  return useInfiniteQuery({
    queryKey: transactionKeys.infinite(filters as Record<string, unknown>, pageSize),
    queryFn: ({ pageParam }) => fetchTransactionPage(filters, pageSize, pageParam),
    initialPageParam: 0,

    // A short page means the backend has no next page
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < pageSize ? undefined : allPages.length * pageSize,
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Reads transaction overview metrics for the top-band cards
 */
export function useTransactionsOverview(filters: OverviewFilters = {}) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: transactionOverviewKeys.detail(filters as Record<string, unknown>),
    queryFn: () => fetchTransactionsOverview(filters),
    enabled: !!accessToken,
    staleTime: getFxAwareStaleTime(TRANSACTION_OVERVIEW_FX_STALE_TIME_MS),
  });
}

// A transaction opened on its own is served from cache for this long before a refetch, since the
// only edits that matter are the ones made in this tab, which invalidate the detail themselves
const TRANSACTION_DETAIL_STALE_TIME_MS = 10 * 60 * 1000;

/**
 * Loads a single transaction by id through the query cache, for opening one that is not already
 * sitting in a loaded list page
 */
export function useLoadTransaction() {
  const queryClient = useQueryClient();
  return useCallback(
    (transactionId: string) =>
      queryClient.fetchQuery({
        queryKey: transactionKeys.detail(transactionId),
        queryFn: () => fetchTransaction(transactionId),
        staleTime: TRANSACTION_DETAIL_STALE_TIME_MS,
      }),
    [queryClient],
  );
}

interface UseCreateTransactionOptions {
  deferAccountInvalidation?: boolean;
  // Holds the transactions-page list and overview refreshes so the caller can flush them once, when a
  // create modal is dismissed, instead of refetching the page behind it on every save
  deferTransactionInvalidation?: boolean;
}

/**
 * Creates transactions and refreshes every aggregate view that consumes transaction activity
 */
export function useCreateTransaction({
  deferAccountInvalidation = false,
  deferTransactionInvalidation = false,
}: UseCreateTransactionOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTransaction,
    onSuccess: (transaction) => {
      const accountIds = [transaction.account_id];
      if (!deferTransactionInvalidation) invalidateTransactions(queryClient);
      invalidateFinancialTransactionData(queryClient, accountIds, {
        deferAccountInvalidation,
        deferTransactionOverview: deferTransactionInvalidation,
      });
      invalidateInsightsMerchants(queryClient);
    },
  });
}

/**
 * Invalidates the transactions list, its overview, and the account data for the given accounts,
 * for flushing a session of created transactions that deferred its own invalidation
 */
export function useRefreshCreatedTransactions() {
  const queryClient = useQueryClient();
  return useCallback(
    (accountIds: string[]) => {
      invalidateTransactions(queryClient);
      invalidateTransactionOverview(queryClient);
      invalidateTransactionAccountData(queryClient, accountIds, { refetchAccountList: true });
    },
    [queryClient],
  );
}

/**
 * Updates transactions and invalidates only the views affected by changed fields
 */
export function useUpdateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateTransaction,
    onMutate: ({ id }: { id: string; patch: UpdateTransactionPayload }) => ({
      previousTransaction: findCachedTransaction(queryClient, id),
    }),
    onSuccess: (updated, { patch }, context) => {
      const accountIds = uniqueIds([
        context?.previousTransaction?.account_id,
        updated.account_id,
      ]);
      invalidatePatchedTransactionData(queryClient, patch, accountIds);
    },
  });
}

/**
 * Removes a deleted transaction from the cached lists and refreshes the aggregate views it fed, split
 * out so the caller can defer it until the modal has dismissed and the row can animate out in view
 */
export function applyTransactionDeletion(
  queryClient: QueryClient,
  transactionId: string,
  accountId: string | undefined,
) {
  const accountIds = uniqueIds([accountId]);
  removeTransactionFromLists(queryClient, transactionId);
  invalidateTransactions(queryClient);
  invalidateFinancialTransactionData(queryClient, accountIds);
  invalidateInsightsMerchants(queryClient);
}

/**
 * Deletes transactions and refreshes all aggregate views affected by removed activity, holding the
 * cache removal for the caller when deferRemoval is set so the row stays until the modal dismisses
 */
export function useDeleteTransaction({
  minimumPendingMs = 0,
  deferRemoval = false,
}: { minimumPendingMs?: number; deferRemoval?: boolean } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runWithMinimumPendingTime(minimumPendingMs, () => deleteTransaction(id)),
    onMutate: (id) => ({
      deletedTransaction: findCachedTransaction(queryClient, id),
    }),
    onSuccess: (_data, id, context) => {
      if (deferRemoval) return;
      applyTransactionDeletion(queryClient, id, context?.deletedTransaction?.account_id);
    },
  });
}
