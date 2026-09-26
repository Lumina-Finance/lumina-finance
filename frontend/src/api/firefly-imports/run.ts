import { buildFireflyStageBatches } from '@/api/firefly-imports/batching';
import {
  commitFireflyImportRun,
  openFireflyImportRun,
  putFireflyImportRunArchive,
  putFireflyImportRunBudgets,
  stageFireflyImportRows,
} from '@/api/firefly-imports/requests';
import type {
  FireflyImportRunBudgets,
  FireflyImportRunResponse,
  FireflyTransactionImportPayload,
} from '@/api/firefly-imports/types';
import { TransactionImportRunError, discardStagedRun } from '@/api/transaction-imports/run';
import { getImportFailureMessage } from '@/utils/importFailure';

/**
 * A prepared Firefly III import: the export's rows, the budgets created alongside them, and the
 * accounts it creates that are then archived
 */
export interface FireflyImportRequest {
  payload: FireflyTransactionImportPayload;

  /** Absent when no budget is imported */
  budgets: FireflyImportRunBudgets | null;

  /** Account sources answered create-new that Firefly III marks inactive */
  archiveAccountSources: string[];
}

/**
 * Uploads a prepared Firefly III import and writes all of it in one transaction
 *
 * The export, its budgets and the accounts to archive are staged over as many requests as their
 * size needs, and nothing reaches the ledger until the commit writes the whole run at once. So an
 * upload that stops part way, whether it failed or was abandoned, leaves nothing a user can see
 *
 * @param request - The prepared rows, budgets and accounts to archive
 * @param signal - Abandons the upload. The run is dropped when this fires during staging, while
 *   during the commit it only stops waiting, since the commit may already have landed
 * @param onStaged - Runs once everything is staged, before the commit starts, so the screen can
 *   show the upload finishing. Stopping while it runs still counts as stopping during staging
 */
export async function runFireflyImport(
  { payload, budgets, archiveAccountSources }: FireflyImportRequest,
  signal?: AbortSignal,
  onStaged?: () => Promise<void>,
): Promise<FireflyImportRunResponse> {
  const batches = await buildFireflyStageBatches(payload);
  const run = await openFireflyImportRun(payload.rows.length, signal);

  try {
    for (const batch of batches) await stageFireflyImportRows(run.id, batch, signal);
    if (budgets && budgets.budgets.length > 0) await putFireflyImportRunBudgets(run.id, budgets, signal);
    if (archiveAccountSources.length > 0) await putFireflyImportRunArchive(run.id, archiveAccountSources, signal);
    await onStaged?.();
    signal?.throwIfAborted();
  } catch (error) {
    await discardStagedRun(run.id);
    throw new TransactionImportRunError(getImportFailureMessage(error), 'staging', null, { cause: error });
  }

  return commitStagedFireflyRun(run.id, signal);
}

/**
 * Writes an already staged Firefly III run
 *
 * Separate from the upload so a commit that failed for a reason committing again could clear,
 * such as a dropped connection, can be run again without re-uploading the export
 *
 * @param runId - The staged run to commit
 * @param signal - Stops waiting for the commit. It does not stop the commit itself
 */
export async function commitStagedFireflyRun(runId: string, signal?: AbortSignal): Promise<FireflyImportRunResponse> {
  try {
    return await commitFireflyImportRun(runId, signal);
  } catch (error) {
    throw new TransactionImportRunError(getImportFailureMessage(error), 'commit', runId, { cause: error });
  }
}
