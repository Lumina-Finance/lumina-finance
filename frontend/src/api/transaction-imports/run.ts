import { ApiError } from '@/api/auth/errors';
import { buildStagedImportBatches } from '@/api/transaction-imports/batching';
import {
  commitTransactionImportRun,
  deleteTransactionImportRun,
  openTransactionImportRun,
  stageTransactionImportRows,
} from '@/api/transaction-imports/requests';
import type {
  TransactionImportPayload,
  TransactionImportResponse,
} from '@/api/transaction-imports/types';
import { getImportFailureMessage } from '@/utils/importFailure';

/** Which half of the upload an import stopped in, which decides what can be done about it */
export type TransactionImportPhase = 'staging' | 'commit';

// What the server answers when the file itself cannot be written, or when the run or an account it
// maps is out of reach. A refusal outside these is offered another attempt, which is what a commit
// already running needs, since committing again answers with what that one wrote
const PERMANENT_COMMIT_FAILURE_STATUSES = new Set([404, 422]);

// How the server refuses to drop a run that has been committed, which is the one refusal that
// says a commit whose answer was lost did land. The server refuses a run another request is still
// working on with the same status, so only this text tells the two apart
const RUN_ALREADY_COMMITTED_STATUS = 409;
const RUN_ALREADY_COMMITTED_DETAIL = 'This import has already been committed';

/**
 * What dropping a kept run found out about it: that nothing of it was saved, that its commit had
 * landed after all, or nothing either way
 */
export type StagedRunSettlement = 'discarded' | 'saved' | 'unsettled';

/**
 * An import that stopped, and what is left of it
 *
 * A failure while staging leaves nothing to act on: dropping the run is attempted before this is
 * thrown, and a drop that fails itself leaves staged rows nothing reads. A failure while
 * committing leaves the file staged, so the same run can be committed again
 */
export class TransactionImportRunError extends Error {
  readonly phase: TransactionImportPhase;

  /** The staged run still waiting to be committed, absent once nothing is left of it */
  readonly runId: string | null;

  constructor(message: string, phase: TransactionImportPhase, runId: string | null, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TransactionImportRunError';
    this.phase = phase;
    this.runId = runId;
  }
}

/**
 * Uploads a prepared import and writes it to the ledger
 *
 * The file is staged over as many requests as its size needs, and none of it reaches the ledger
 * until the commit writes the whole run at once. So an upload that stops part way, whether it
 * failed or was abandoned, leaves nothing a user can see
 *
 * @param payload - The prepared import, as the mapping steps built it
 * @param signal - Abandons the upload. The run is dropped when this fires during staging, while
 *   during the commit it only stops waiting, since the commit may already have landed
 */
export async function runTransactionImport(
  payload: TransactionImportPayload,
  signal?: AbortSignal,
): Promise<TransactionImportResponse> {
  const batches = await buildStagedImportBatches(payload);
  const run = await openTransactionImportRun(payload.rows.length, signal);

  for (const batch of batches) {
    try {
      await stageTransactionImportRows(run.id, batch, signal);
    } catch (error) {
      await discardStagedRun(run.id);
      throw new TransactionImportRunError(getImportFailureMessage(error), 'staging', null, { cause: error });
    }
  }

  return commitStagedImportRun(run.id, signal);
}

/**
 * Writes an already staged run to the ledger
 *
 * Separate from the upload so a commit that failed for a reason committing again could clear,
 * such as a dropped connection, can be run again without re-uploading the file
 *
 * @param runId - The staged run to commit
 * @param signal - Stops waiting for the commit. It does not stop the commit itself
 */
export async function commitStagedImportRun(
  runId: string,
  signal?: AbortSignal,
): Promise<TransactionImportResponse> {
  try {
    return await commitTransactionImportRun(runId, signal);
  } catch (error) {
    throw new TransactionImportRunError(getImportFailureMessage(error), 'commit', runId, { cause: error });
  }
}

/**
 * Drops a staged run, ignoring a failure to do so
 *
 * What it leaves behind is staged rows nothing reads, so a user is told about the import that
 * failed rather than about the clearing up after it
 *
 * @param runId - The staged run to drop
 */
export async function discardStagedRun(runId: string): Promise<void> {
  try {
    await deleteTransactionImportRun(runId);
  } catch {
    // Nothing to report: an undropped run is invisible rows, not something a user can act on
  }
}

/**
 * Drops a kept run and reports whether its commit had landed
 *
 * A run whose commit failed with no answer may have been written anyway, and the server keeps a
 * committed run, refusing to drop it. So the drop itself is what tells an import about to start
 * afresh whether starting would write the same rows a second time
 *
 * @param runId - The kept run to drop
 */
export async function settleStagedRun(runId: string): Promise<StagedRunSettlement> {
  try {
    await deleteTransactionImportRun(runId);
    return 'discarded';
  } catch (error) {
    if (!(error instanceof ApiError)) return 'unsettled';

    // A committed run is never deleted, so one that is gone was never written
    if (error.status === 404) return 'discarded';
    if (error.status === RUN_ALREADY_COMMITTED_STATUS && error.detail === RUN_ALREADY_COMMITTED_DETAIL) return 'saved';
    return 'unsettled';
  }
}

/**
 * Whether committing the same run again could give a different answer
 *
 * A refusal of the file itself repeats however many times it is sent, and a run or an account that
 * is out of reach stays that way. Everything else is worth another attempt, including a commit
 * already running, which answers with what it wrote once it finishes, and an abort, for the same
 * reason
 *
 * @param error - The error a commit threw
 */
export function isImportCommitWorthRepeating(error: unknown): boolean {
  const cause = error instanceof TransactionImportRunError ? error.cause : error;
  if (!(cause instanceof ApiError)) return true;
  return !PERMANENT_COMMIT_FAILURE_STATUSES.has(cause.status);
}
