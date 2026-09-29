import { authenticatedFetch } from '@/api/client';
import type {
  ImportRunBudgets,
  JournalImportRunResponse,
  JournalImportSource,
  JournalImportStageBatch,
} from '@/api/provider-imports/types';
import type { TransactionImportRun } from '@/api/transaction-imports/types';

/**
 * Opens a run for a provider export about to be staged, stating which app it came from and how many
 * journal rows it holds
 */
export function openJournalImportRun(source: JournalImportSource, journalRowCount: number, signal?: AbortSignal) {
  return authenticatedFetch<TransactionImportRun>('/transactions/import/runs', {
    method: 'POST',
    body: JSON.stringify({ expected_transaction_count: journalRowCount, source }),
    signal,
  });
}

/**
 * Parks one batch of an export against its run, creating nothing
 */
export function stageJournalImportRows(runId: string, batch: JournalImportStageBatch, signal?: AbortSignal) {
  return authenticatedFetch<void>(`/transactions/import/runs/${runId}/journal/rows`, {
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
export function putImportRunBudgets(runId: string, budgets: ImportRunBudgets, signal?: AbortSignal) {
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
export function putImportRunArchive(runId: string, accountSources: string[], signal?: AbortSignal) {
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
export function commitJournalImportRun(runId: string, signal?: AbortSignal) {
  return authenticatedFetch<JournalImportRunResponse>(`/transactions/import/runs/${runId}/journal/commit`, {
    method: 'POST',
    signal,
  });
}

/**
 * Reads what a staged export's commit wrote, without ever writing it
 *
 * Refused with 409 while the run is uncommitted, and with 422 once it has sat uncommitted long
 * enough to be abandoned, which the server then never saves
 */
export function fetchJournalImportRunResult(runId: string, signal?: AbortSignal) {
  return authenticatedFetch<JournalImportRunResponse>(`/transactions/import/runs/${runId}/journal/result`, { signal });
}
