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

/** Which half of the upload an import stopped in, which decides what can be done about it */
export type TransactionImportPhase = 'staging' | 'commit';

// What the server answers when the file itself cannot be written, or when the run is gone. Every
// other refusal, a commit already running included, can answer differently on a second attempt
const PERMANENT_COMMIT_FAILURE_STATUSES = new Set([404, 422]);

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
      throw new TransactionImportRunError(getImportErrorMessage(error), 'staging', null, { cause: error });
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
    throw new TransactionImportRunError(getImportErrorMessage(error), 'commit', runId, { cause: error });
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
 * Whether committing the same run again could give a different answer
 *
 * A refusal of the file itself repeats however many times it is sent, and a run that is gone stays
 * gone. Everything else is worth another attempt, including a commit already running, which
 * answers with what it wrote once it finishes, and an abort, for the same reason
 *
 * @param error - The error a commit threw
 */
export function isImportCommitWorthRepeating(error: unknown): boolean {
  const cause = error instanceof TransactionImportRunError ? error.cause : error;
  if (!(cause instanceof ApiError)) return true;
  return !PERMANENT_COMMIT_FAILURE_STATUSES.has(cause.status);
}

function getImportErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Import failed.';
}
