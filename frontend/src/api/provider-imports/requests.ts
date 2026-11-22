import { authenticatedFetch } from '@/api/client'
import type { ImportRunBudgetsPart } from '@/api/provider-imports/types'

/**
 * Stages one part of the budgets a run creates once its transactions are written
 *
 * The part replaces the run's budgets from its start index onward. Sending it again when a
 * response goes missing therefore changes nothing
 */
export function putImportRunBudgets(runId: string, budgets: ImportRunBudgetsPart, signal?: AbortSignal) {
  return authenticatedFetch<void>(`/transactions/import/runs/${runId}/budgets`, {
    method: 'PUT',
    body: JSON.stringify(budgets),
    signal,
  })
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
  })
}
