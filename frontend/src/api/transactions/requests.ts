import { authenticatedFetch } from '@/api/client';
import { buildQueryString, type QueryStringValue } from '@/api/utils/queryString';
import type {
  BulkDeleteTransactionsResult,
  BulkUpdateTransactionsPayload,
  BulkUpdateTransactionsResult,
  CreateTransactionPayload,
  OverviewFilters,
  Transaction,
  TransactionFilters,
  TransactionsOverview,
  UpdateTransactionPayload,
} from '@/api/transactions/types';

/**
 * Fetches one transaction by ID
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchTransaction(transactionId: string, signal?: AbortSignal) {
  return authenticatedFetch<Transaction>(`/transactions/${transactionId}`, { signal });
}

/**
 * Fetches transactions for a filter set used by transaction lists and selectors
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchTransactions(filters: TransactionFilters = {}, signal?: AbortSignal) {
  return authenticatedFetch<Transaction[]>(
    '/transactions' + buildQueryString(filters as Record<string, QueryStringValue>),
    { signal },
  );
}

/**
 * Fetches one paginated transaction page while preserving the list filter contract
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchTransactionPage(
  filters: Omit<TransactionFilters, 'limit' | 'offset'> = {},
  pageSize = 15,
  offset = 0,
  signal?: AbortSignal,
) {
  return fetchTransactions(
    {
      ...filters,
      limit: pageSize,
      offset,
    },
    signal,
  );
}

/**
 * Fetches transaction summary data for dashboard and transaction overview cards
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchTransactionsOverview(filters: OverviewFilters = {}, signal?: AbortSignal) {
  return authenticatedFetch<TransactionsOverview>(
    '/transactions/overview' + buildQueryString(filters as Record<string, QueryStringValue>),
    { signal },
  );
}

/**
 * Creates one transaction
 */
export function createTransaction(payload: CreateTransactionPayload) {
  return authenticatedFetch<Transaction>('/transactions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Updates mutable transaction fields
 */
export function updateTransaction({ id, patch }: { id: string; patch: UpdateTransactionPayload }) {
  return authenticatedFetch<Transaction>(`/transactions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/**
 * Sets a category, a merchant or extra tags across several transactions in one request
 */
export function bulkUpdateTransactions(payload: BulkUpdateTransactionsPayload) {
  return authenticatedFetch<BulkUpdateTransactionsResult>('/transactions/bulk', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/**
 * Deletes several transactions in one request, all of them or none
 */
export function bulkDeleteTransactions(transactionIds: string[]) {
  return authenticatedFetch<BulkDeleteTransactionsResult>('/transactions/bulk/delete', {
    method: 'POST',
    body: JSON.stringify({ transaction_ids: transactionIds }),
  });
}

/**
 * Deletes one transaction by ID
 */
export function deleteTransaction(id: string) {
  return authenticatedFetch<void>(`/transactions/${id}`, { method: 'DELETE' });
}
