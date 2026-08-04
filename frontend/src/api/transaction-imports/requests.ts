import { authenticatedFetch } from '@/api/client';
import type {
  TransactionImportResponse,
  TransactionImportRun,
  TransactionImportStageBatch,
} from '@/api/transaction-imports/types';

/**
 * Opens a run for a file about to be staged, stating how many rows it will write
 */
export function openTransactionImportRun(expectedTransactionCount: number, signal?: AbortSignal) {
  return authenticatedFetch<TransactionImportRun>('/transactions/import/runs', {
    method: 'POST',
    body: JSON.stringify({ expected_transaction_count: expectedTransactionCount }),
    signal,
  });
}

/**
 * Parks one batch of a file against its run, creating nothing
 */
export function stageTransactionImportRows(
  runId: string,
  batch: TransactionImportStageBatch,
  signal?: AbortSignal,
) {
  return authenticatedFetch<void>(`/transactions/import/runs/${runId}/rows`, {
    method: 'POST',
    body: JSON.stringify(batch),
    signal,
  });
}

/**
 * Writes a staged run into the ledger and returns what it created
 *
 * Answering a second time with the summary of the first is what makes this safe to send again
 * when a response goes missing
 */
export function commitTransactionImportRun(runId: string, signal?: AbortSignal) {
  return authenticatedFetch<TransactionImportResponse>(`/transactions/import/runs/${runId}/commit`, {
    method: 'POST',
    signal,
  });
}

/**
 * Drops a staged run and everything staged under it
 *
 * Deliberately takes no abort signal: this is what runs after an upload was abandoned, so the
 * signal that abandoned it must not take this with it
 */
export function deleteTransactionImportRun(runId: string) {
  return authenticatedFetch<void>(`/transactions/import/runs/${runId}`, {
    method: 'DELETE',
  });
}
