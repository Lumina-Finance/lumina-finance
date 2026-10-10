import { authenticatedFetch } from '@/api/client';
import type {
  LastImport,
  ImportRun,
  ImportRunRoutes,
  ImportUndoResult,
  OpenImportRunRequest,
} from '@/api/import-runs/types';

const IMPORT_RUNS_PATH = '/transactions/import/runs';

// How long a request that sends, writes or deletes an import's rows may go unanswered. These scale
// with the file, so a large import on a slow connection can take far longer than an ordinary request
const IMPORT_REQUEST_TIMEOUT_MS = 5 * 60_000;

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
    timeoutMs: IMPORT_REQUEST_TIMEOUT_MS,
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
    timeoutMs: IMPORT_REQUEST_TIMEOUT_MS,
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
    timeoutMs: IMPORT_REQUEST_TIMEOUT_MS,
  });
}

/**
 * Reads the last saved import while it can still be undone, with what undoing it would delete and keep,
 * or null when there is none
 */
export function fetchLastImport() {
  return authenticatedFetch<LastImport | null>('/transactions/import/last');
}

/**
 * Deletes every transaction a saved import wrote that is still there, all of them or none
 */
export function undoImportRun(runId: string) {
  return authenticatedFetch<ImportUndoResult>(`${IMPORT_RUNS_PATH}/${runId}/undo`, {
    method: 'POST',
    timeoutMs: IMPORT_REQUEST_TIMEOUT_MS,
  });
}
