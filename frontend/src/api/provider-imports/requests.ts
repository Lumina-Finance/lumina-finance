import { authenticatedFetch } from '@/api/client';
import type { ImportRunBudgets } from '@/api/provider-imports/types';

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
