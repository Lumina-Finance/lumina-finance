import { useImportRunMutation } from '@/api/import-runs/hooks';
import { commitStagedImportRun, runTransactionImport } from '@/api/transaction-imports/run';
import type { TransactionImportPayload } from '@/api/transaction-imports/types';

/**
 * Provides the mutation boundary for staging a prepared import and committing it
 */
export function useImportTransactions() {
  return useImportRunMutation(({ payload, signal }: { payload: TransactionImportPayload; signal?: AbortSignal }) =>
    runTransactionImport(payload, signal));
}

/**
 * Provides the mutation boundary for committing a file that is already staged
 *
 * A commit that failed for a reason committing again could clear leaves the file staged, and this
 * is what runs when the user asks for that second attempt
 */
export function useCommitStagedImport() {
  return useImportRunMutation(({ runId, signal }: { runId: string; signal?: AbortSignal }) =>
    commitStagedImportRun(runId, signal));
}
