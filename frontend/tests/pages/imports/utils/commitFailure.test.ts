/**
 * Covers what is kept and what is dropped after an import stops, which decides whether the overlay
 * offers to run the commit again or sends the user back to the mapping steps
 */
import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/auth/errors'
import { TransactionImportRunError } from '@/api/transaction-imports'
import { getImportCommitFailure } from '@/pages/imports/utils'

const RUN_ID = 'run_1'

/**
 * Builds the error a stopped commit throws, wrapping the status the server answered with
 */
function commitError(status: number, message = 'Import failed.') {
  return new TransactionImportRunError(message, 'commit', RUN_ID, {
    cause: new ApiError(message, status),
  })
}

describe('what is left after an import stops', () => {
  it('keeps the staged file when a server fault stopped the commit', () => {
    const failure = getImportCommitFailure(commitError(503, 'Request failed (503)'), false)

    expect(failure.retryableRunId).toBe(RUN_ID)
    expect(failure.discardableRunId).toBeNull()
    expect(failure.message).toBe('Request failed (503)')
  })

  // The run is held for the length of the write, so a second commit arriving during the first is
  // refused. Committing again once it finishes answers with what that first commit wrote
  it('keeps the staged file when a commit is already running', () => {
    const failure = getImportCommitFailure(commitError(409, 'This import is already being worked on'), false)

    expect(failure.retryableRunId).toBe(RUN_ID)
    expect(failure.discardableRunId).toBeNull()
  })

  it('drops the staged file when the server refused the file itself', () => {
    const failure = getImportCommitFailure(commitError(422, 'Invalid amount: $2.00'), false)

    expect(failure.retryableRunId).toBeNull()
    expect(failure.discardableRunId).toBe(RUN_ID)
    expect(failure.message).toBe('Invalid amount: $2.00')
  })

  it('drops the staged file when the run is gone', () => {
    const failure = getImportCommitFailure(commitError(404, 'Import run not found'), false)

    expect(failure.retryableRunId).toBeNull()
    expect(failure.discardableRunId).toBe(RUN_ID)
  })

  it('keeps the staged file when the connection dropped rather than the server answering', () => {
    const failure = getImportCommitFailure(
      new TransactionImportRunError('Failed to fetch', 'commit', RUN_ID, { cause: new TypeError('Failed to fetch') }),
      false,
    )

    expect(failure.retryableRunId).toBe(RUN_ID)
  })

  it('has nothing to keep or drop when staging stopped, since the run is already gone', () => {
    const failure = getImportCommitFailure(
      new TransactionImportRunError('Account is archived', 'staging', null, { cause: new ApiError('Account is archived', 422) }),
      false,
    )

    expect(failure.retryableRunId).toBeNull()
    expect(failure.discardableRunId).toBeNull()
  })
})

describe('what the user is told after stopping an import', () => {
  it('says nothing was written when they stopped it before the commit', () => {
    const failure = getImportCommitFailure(
      new TransactionImportRunError('The operation was aborted', 'staging', null),
      true,
    )

    expect(failure.message).toBe('Import stopped, and nothing was added to your ledger.')
  })

  it('says the write may have finished when they stopped it during the commit', () => {
    const failure = getImportCommitFailure(
      new TransactionImportRunError('The operation was aborted', 'commit', RUN_ID),
      true,
    )

    expect(failure.message).toBe(
      'Import stopped while it was being written. Check your transactions before importing this file again.',
    )
  })
})
