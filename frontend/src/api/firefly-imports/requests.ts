import { authenticatedFetch } from '@/api/client';
import type {
  FireflyImportRunBudgets,
  FireflyImportRunResponse,
  FireflyImportStageBatch,
} from '@/api/firefly-imports/types';
import type { TransactionImportRun } from '@/api/transaction-imports/types';

/**
 * Opens a run for a Firefly III export about to be staged, stating how many journal rows it holds
 */
export function openFireflyImportRun(journalRowCount: number, signal?: AbortSignal) {
  return authenticatedFetch<TransactionImportRun>('/transactions/import/runs', {
    method: 'POST',
    body: JSON.stringify({ expected_transaction_count: journalRowCount, source: 'firefly' }),
    signal,
  });
}

/**
 * Parks one batch of an export against its run, creating nothing
 */
export function stageFireflyImportRows(runId: string, batch: FireflyImportStageBatch, signal?: AbortSignal) {
  return authenticatedFetch<void>(`/transactions/import/runs/${runId}/firefly/rows`, {
    method: 'POST',
    body: JSON.stringify(batch),
    signal,
  });
}

/**
 * Replaces the budgets a run creates once its transactions are written
 *
 * Replacing rather than adding is what makes this safe to send again when a response goes missing
 */
export function putFireflyImportRunBudgets(runId: string, budgets: FireflyImportRunBudgets, signal?: AbortSignal) {
  return authenticatedFetch<void>(`/transactions/import/runs/${runId}/budgets`, {
    method: 'PUT',
    body: JSON.stringify(budgets),
    signal,
  });
}

/**
 * Replaces the accounts a run archives once everything else is written, each named by its account
 * source and each one the import creates
 *
 * Replacing rather than adding is what makes this safe to send again when a response goes missing
 */
export function putFireflyImportRunArchive(runId: string, accountSources: string[], signal?: AbortSignal) {
  return authenticatedFetch<void>(`/transactions/import/runs/${runId}/archive`, {
    method: 'PUT',
    body: JSON.stringify({ account_sources: accountSources }),
    signal,
  });
}

/**
 * Writes a staged export, its budgets and everything they reference in one transaction
 *
 * Answering a second time with the summary of the first is what makes this safe to send again
 * when a response goes missing
 */
export function commitFireflyImportRun(runId: string, signal?: AbortSignal) {
  return authenticatedFetch<FireflyImportRunResponse>(`/transactions/import/runs/${runId}/firefly/commit`, {
    method: 'POST',
    signal,
  });
}
