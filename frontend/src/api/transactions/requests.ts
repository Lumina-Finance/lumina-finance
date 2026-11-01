import { authenticatedFetch, authenticatedRequest } from '@/api/client'
import { buildQueryString, type QueryStringValue } from '@/api/utils/queryString'
import type {
  BulkDeleteTransactionsResult,
  BulkUpdateTransactionsPayload,
  BulkUpdateTransactionsResult,
  CreateTransactionPayload,
  ExportTransactionsFilters,
  LinkCandidateFilters,
  OverviewFilters,
  Transaction,
  TransactionFilters,
  TransactionsOverview,
  UpdateTransactionPayload,
} from '@/api/transactions/types'

/**
 * Fetches one transaction by ID
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchTransaction(transactionId: string, signal?: AbortSignal) {
  return authenticatedFetch<Transaction>(`/transactions/${transactionId}`, { signal })
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
  )
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
  )
}

// A large export is read to its end before the file is saved, so it gets longer than an ordinary
// request before it counts as unanswered
const EXPORT_TIMEOUT_MS = 180_000

/**
 * Downloads every transaction matching the list's filters as a CSV file
 *
 * @param signal - Aborts the request when the export that asked for it is abandoned
 */
export async function fetchTransactionsCsv(filters: ExportTransactionsFilters = {}, signal?: AbortSignal) {
  const response = await authenticatedRequest(
    '/transactions/export' + buildQueryString(filters as Record<string, QueryStringValue>),
    { signal, timeoutMs: EXPORT_TIMEOUT_MS, headers: { Accept: 'text/csv' } },
  )
  return response.blob()
}

/**
 * Downloads exactly the chosen transactions as a CSV file, in the list's order
 *
 * A POST, since the chosen ids are too many for a query string
 */
export async function fetchSelectedTransactionsCsv(transactionIds: string[], signal?: AbortSignal) {
  const response = await authenticatedRequest('/transactions/export', {
    method: 'POST',
    body: JSON.stringify({ transaction_ids: transactionIds }),
    signal,
    timeoutMs: EXPORT_TIMEOUT_MS,
    headers: { Accept: 'text/csv' },
  })
  return response.blob()
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
  )
}

/**
 * Creates one transaction
 */
export function createTransaction(payload: CreateTransactionPayload) {
  return authenticatedFetch<Transaction>('/transactions', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * Updates mutable transaction fields
 */
export function updateTransaction({ id, patch }: { id: string; patch: UpdateTransactionPayload }) {
  return authenticatedFetch<Transaction>(`/transactions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/**
 * Sets a category, a merchant or extra tags across several transactions in one request
 */
export function bulkUpdateTransactions(payload: BulkUpdateTransactionsPayload) {
  return authenticatedFetch<BulkUpdateTransactionsResult>('/transactions/bulk', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

/**
 * Deletes several transactions in one request, all of them or none. A link to a transaction left
 * out goes with the one deleted
 */
export function bulkDeleteTransactions(transactionIds: string[]) {
  return authenticatedFetch<BulkDeleteTransactionsResult>('/transactions/bulk/delete', {
    method: 'POST',
    body: JSON.stringify({ transaction_ids: transactionIds }),
  })
}

/**
 * Links an existing transaction as the refund of an expense, leaving both as they are
 */
export function linkRefund(refundId: string, originalTransactionId: string) {
  return authenticatedFetch<void>(`/transactions/${refundId}/refund-link`, {
    method: 'POST',
    body: JSON.stringify({ original_transaction_id: originalTransactionId }),
  })
}

/**
 * Fetches the transactions one can be linked to: the money that came in for an expense, the
 * expenses for a refund. The server applies the rules, so every one returned would be accepted
 *
 * The list comes with the exact amount first, then the nearest amounts, and takes the transaction list's
 * filters to narrow it
 *
 * @param filters - The transaction list's filters, narrowing the candidates the way they narrow the list
 * @param signal - Aborts the request when the search that asked for it is replaced
 */
export function fetchRefundLinkCandidates(
  transactionId: string,
  searchText: string,
  filters: LinkCandidateFilters = {},
  signal?: AbortSignal,
) {
  return authenticatedFetch<Transaction[]>(
    `/transactions/${transactionId}/refund-link-candidates` +
      buildQueryString({ ...filters, q: searchText || undefined } as Record<string, QueryStringValue>),
    { signal },
  )
}

/**
 * Removes the link between a refund and the expense it refunds, leaving both transactions as they are
 */
export function unlinkRefund(refundId: string) {
  return authenticatedFetch<void>(`/transactions/${refundId}/refund-link`, { method: 'DELETE' })
}

/**
 * Deletes one transaction by ID
 */
export function deleteTransaction(id: string) {
  return authenticatedFetch<void>(`/transactions/${id}`, { method: 'DELETE' })
}
