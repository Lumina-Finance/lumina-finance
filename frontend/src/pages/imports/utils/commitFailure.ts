import { TransactionImportRunError, isImportCommitWorthRepeating } from '@/api/transaction-imports'
import { getErrorMessage } from '@/pages/imports/utils/payload'

// What the user is told after stopping an import themselves, which reads differently either side of
// the commit: before it nothing has been written, and during it the write may already have finished
const IMPORT_STOPPED_WHILE_STAGING_MESSAGE = 'Import stopped, and nothing was added to your ledger.'
const IMPORT_STOPPED_WHILE_COMMITTING_MESSAGE = 'Import stopped while it was being written. Check your transactions before importing this file again.'

/** What is left of an import that stopped, and what the user is told about it */
export interface ImportCommitFailure {
  message: string

  /** The staged file still worth committing again, absent when repeating cannot help */
  retryableRunId: string | null

  /** A staged file that will never commit, so nothing is waiting on it being kept */
  discardableRunId: string | null
}

/**
 * Works out what to show and what to keep after an import stopped
 *
 * A file the server refused for its own contents will be refused again however many times it is
 * sent, so its run is dropped rather than offered as something to retry. Anything else keeps the
 * file staged, which is what makes a second attempt cost one request rather than the whole upload
 *
 * @param error - What the attempt threw
 * @param cancelled - Whether the user stopped it rather than it failing on its own
 */
export function getImportCommitFailure(error: unknown, cancelled: boolean): ImportCommitFailure {
  const runId = error instanceof TransactionImportRunError ? error.runId : null
  const worthRepeating = runId !== null && isImportCommitWorthRepeating(error)
  const stoppedDuringCommit = error instanceof TransactionImportRunError && error.phase === 'commit'

  return {
    message: cancelled
      ? (stoppedDuringCommit ? IMPORT_STOPPED_WHILE_COMMITTING_MESSAGE : IMPORT_STOPPED_WHILE_STAGING_MESSAGE)
      : getErrorMessage(error),
    retryableRunId: worthRepeating ? runId : null,
    discardableRunId: worthRepeating ? null : runId,
  }
}
