import { authenticatedFetch } from '@/api/client';
import { buildQueryString, type QueryStringValue } from '@/api/utils/queryString';
import type {
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
 */
export function fetchTransaction(transactionId: string) {
  return authenticatedFetch<Transaction>(`/transactions/${transactionId}`);
}

/**
 * Fetches transactions for a filter set used by transaction lists and selectors
 */
export function fetchTransactions(filters: TransactionFilters = {}) {
  return authenticatedFetch<Transaction[]>(
    '/transactions' + buildQueryString(filters as Record<string, QueryStringValue>),
  );
}

/**
 * Fetches one paginated transaction page while preserving the list filter contract
 */
export function fetchTransactionPage(
  filters: Omit<TransactionFilters, 'limit' | 'offset'> = {},
  pageSize = 15,
  offset = 0,
) {
  return fetchTransactions({
    ...filters,
    limit: pageSize,
    offset,
  });
}

/**
 * Fetches transaction summary data for dashboard and transaction overview cards
 */
export function fetchTransactionsOverview(filters: OverviewFilters = {}) {
  return authenticatedFetch<TransactionsOverview>(
    '/transactions/overview' + buildQueryString(filters as Record<string, QueryStringValue>),
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
 * Deletes one transaction by ID
 */
export function deleteTransaction(id: string) {
  return authenticatedFetch<void>(`/transactions/${id}`, { method: 'DELETE' });
}
