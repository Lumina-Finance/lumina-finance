import { ApiError, isAnsweredByApp } from '@/api/auth/errors'
import { authenticatedFetch, authenticatedRequest } from '@/api/client'
import { createTimeoutError } from '@/api/server'
import type {
  LastImport,
  ImportRun,
  ImportRunRoutes,
  ImportUndoResult,
  OpenImportRunRequest,
} from '@/api/import-runs/types'

const IMPORT_RUNS_PATH = '/transactions/import/runs'

// How long a request that sends or deletes an import's rows may go unanswered, and in all how long
// the page waits for a save to finish. These scale with the file, so a large import on a slow
// connection can take far longer than an ordinary request. The request that asks for a save is
// answered at once and has the ordinary limit
const IMPORT_REQUEST_TIMEOUT_MS = 5 * 60_000

/**
 * Opens a run for an import about to be uploaded
 */
export function openImportRun(request: OpenImportRunRequest, signal?: AbortSignal) {
  return authenticatedFetch<ImportRun>(IMPORT_RUNS_PATH, {
    method: 'POST',
    body: JSON.stringify(request),
    signal,
  })
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
  })
}

// The status of an answer that says the save is still going, and asks to be asked again
const SAVE_GOING_STATUS = 202

// How often the page asks whether a save has finished
const SAVE_POLL_INTERVAL_MS = 1_500

/**
 * Writes a staged run and returns what it created
 *
 * The server answers the request at once and writes the run after that, however long the file
 * takes, so the answer to this is found by asking for it every 1.5 seconds. The wait is as long
 * as one request was allowed before, in all. A poll that fails without an answer from the app, such
 * as a dropped connection or a gateway's page, is asked again, since the save carries on without the
 * page. Answering a second time with the summary of the first is what makes this safe to send again
 * when a response goes missing
 *
 * @throws ApiError built from the answer when the server refuses the save, and a TimeoutError once
 *   the wait runs out, though the save may still finish
 */
export async function commitImportRun<TResponse>(runId: string, routes: ImportRunRoutes, signal?: AbortSignal) {
  const path = `${IMPORT_RUNS_PATH}/${runId}/${routes.commit}`
  const giveUpAt = Date.now() + IMPORT_REQUEST_TIMEOUT_MS

  let answer: Response | null = await authenticatedRequest(path, { method: 'POST', signal })
  while (answer === null || answer.status === SAVE_GOING_STATUS) {
    await waitToAskAgain(signal)
    if (Date.now() >= giveUpAt) throw createTimeoutError()
    answer = await askHowTheSaveIsGoing(path, signal)
  }
  return (await answer.json()) as TResponse
}

/**
 * Reads how a save is going, or null when the answer didn't reach the page and asking again is
 * what to do
 */
async function askHowTheSaveIsGoing(path: string, signal?: AbortSignal) {
  try {
    return await authenticatedRequest(path, { signal })
  } catch (error) {
    if (signal?.aborted || !isNoAnswerFromApp(error)) throw error
    return null
  }
}

/**
 * Whether a failed request got no answer from the app: a dropped connection, a request that went
 * unanswered, or a gateway's own page
 */
function isNoAnswerFromApp(error: unknown) {
  if (error instanceof ApiError) return !isAnsweredByApp(error)
  return error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError')
}

/**
 * Waits out the time between two questions about a save, ending early with the caller's reason when
 * the caller stops waiting
 */
function waitToAskAgain(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const stop = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop)
      resolve()
    }, SAVE_POLL_INTERVAL_MS)
    signal?.addEventListener('abort', stop, { once: true })
  })
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
  })
}

/**
 * Reads the last saved import while it can still be undone, with what undoing it would delete and keep,
 * or null when there is none
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchLastImport(signal?: AbortSignal) {
  return authenticatedFetch<LastImport | null>('/transactions/import/last', { signal })
}

/**
 * Asks whether a saved import is still there, which undoing it and the end of its undo window end,
 * though saving a later import does not
 *
 * @param runId - The run the import was saved under
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export async function fetchIsImportRunSaved(runId: string, signal?: AbortSignal) {
  const answer = await authenticatedFetch<{ is_saved: boolean }>(`${IMPORT_RUNS_PATH}/${runId}`, { signal })
  return answer.is_saved
}

/**
 * Deletes every transaction a saved import wrote that is still there, all of them or none
 */
export function undoImportRun(runId: string) {
  return authenticatedFetch<ImportUndoResult>(`${IMPORT_RUNS_PATH}/${runId}/undo`, {
    method: 'POST',
    timeoutMs: IMPORT_REQUEST_TIMEOUT_MS,
  })
}
