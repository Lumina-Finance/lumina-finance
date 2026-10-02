import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { invalidateAppData } from '@/api/cache/invalidation';
import { commitStagedJournalRun, runJournalImport, type JournalImportRequest } from '@/api/provider-imports/run';
import { TransactionImportRunError } from '@/api/transaction-imports/run';

/**
 * Reads the ledger again after a save that ended with no answer, since it may have landed, so a user
 * told to check their transactions sees them as they are
 */
function refreshAfterInterruptedSave(queryClient: QueryClient, error: unknown) {
  if (error instanceof TransactionImportRunError && error.phase === 'commit') invalidateAppData(queryClient);
}

/**
 * Provides the mutation boundary for staging a prepared provider import and committing it
 */
export function useImportJournal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ request, signal, onStaged }: {
      request: JournalImportRequest;
      signal?: AbortSignal;
      onStaged?: () => Promise<void>;
    }) => runJournalImport(request, signal, onStaged),
    onSuccess: () => {
      invalidateAppData(queryClient);
    },
    onError: (error) => refreshAfterInterruptedSave(queryClient, error),
  });
}

/**
 * Provides the mutation boundary for committing a provider import that is already staged
 */
export function useCommitStagedJournalImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, signal }: { runId: string; signal?: AbortSignal }) => commitStagedJournalRun(runId, signal),
    onSuccess: () => {
      invalidateAppData(queryClient);
    },
    onError: (error) => refreshAfterInterruptedSave(queryClient, error),
  });
}
