import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateAppData } from '@/api/cache/invalidation';
import { commitStagedImportRun, runTransactionImport } from '@/api/transaction-imports/run';
import type { TransactionImportPayload } from '@/api/transaction-imports/types';

/**
 * Provides the mutation boundary for staging a prepared import and committing it
 */
export function useImportTransactions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, signal }: { payload: TransactionImportPayload; signal?: AbortSignal }) =>
      runTransactionImport(payload, signal),
    onSuccess: () => {
      invalidateAppData(queryClient);
    },
  });
}

/**
 * Provides the mutation boundary for committing a file that is already staged
 *
 * A commit that failed for a reason committing again could clear leaves the file staged, and this
 * is what runs when the user asks for that second attempt
 */
export function useCommitStagedImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, signal }: { runId: string; signal?: AbortSignal }) =>
      commitStagedImportRun(runId, signal),
    onSuccess: () => {
      invalidateAppData(queryClient);
    },
  });
}
