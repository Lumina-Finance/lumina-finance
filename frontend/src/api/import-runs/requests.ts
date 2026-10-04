import { authenticatedFetch } from '@/api/client';
import type { ImportRun, ImportRunRoutes, OpenImportRunRequest } from '@/api/import-runs/types';

const IMPORT_RUNS_PATH = '/transactions/import/runs';

/**
 * Opens a run for an import about to be uploaded
 */
export function openImportRun(request: OpenImportRunRequest, signal?: AbortSignal) {
  return authenticatedFetch<ImportRun>(IMPORT_RUNS_PATH, {
    method: 'POST',
    body: JSON.stringify(request),
    signal,
  });
}

/**
 * Parks one batch of an import against its run, creating nothing
 */
export function stageImportRunRows(runId: string, routes: ImportRunRoutes, batch: unknown, signal?: AbortSignal) {
  return authenticatedFetch<void>(`${IMPORT_RUNS_PATH}/${runId}/${routes.rows}`, {
    method: 'POST',
    body: JSON.stringify(batch),
    signal,
  });
}

/**
 * Writes a staged run and returns what it created
 *
 * Answering a second time with the summary of the first is what makes this safe to send again
 * when a response goes missing
 */
export function commitImportRun<TResponse>(runId: string, routes: ImportRunRoutes, signal?: AbortSignal) {
  return authenticatedFetch<TResponse>(`${IMPORT_RUNS_PATH}/${runId}/${routes.commit}`, {
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
export function deleteImportRun(runId: string) {
  return authenticatedFetch<void>(`${IMPORT_RUNS_PATH}/${runId}`, {
    method: 'DELETE',
  });
}
