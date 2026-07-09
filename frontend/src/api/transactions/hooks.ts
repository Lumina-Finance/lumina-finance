import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { invalidateInsightsMerchants, invalidateTransactions } from '@/api/cache/invalidation';
import { runWithMinimumPendingTime } from '@/api/utils/mutationFeedback';
import { transactionKeys, transactionOverviewKeys } from '@/api/cache/queryKeys';
import {
  findCachedTransaction,
  invalidateFinancialTransactionData,
  invalidatePatchedTransactionData,
  removeTransactionFromLists,
  uniqueIds,
} from '@/api/cache/updates/transactions';
import {
  createTransaction,
  deleteTransaction,
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
 * Deletes transactions and refreshes all aggregate views affected by removed activity
 */
export function useDeleteTransaction({ minimumPendingMs = 0 }: { minimumPendingMs?: number } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runWithMinimumPendingTime(minimumPendingMs, () => deleteTransaction(id)),
    onMutate: (id) => ({
      deletedTransaction: findCachedTransaction(queryClient, id),
    }),
    onSuccess: (_data, id, context) => {
      const accountIds = uniqueIds([context?.deletedTransaction?.account_id]);

      // Clear the row from the cached lists first so it disappears with the modal, then invalidate to
      // reconcile pagination and the aggregate views
      removeTransactionFromLists(queryClient, id);
      invalidateTransactions(queryClient);
      invalidateFinancialTransactionData(queryClient, accountIds);
      invalidateInsightsMerchants(queryClient);
    },
  });
}
