import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateAppData } from '@/api/cache/invalidation';
import { checkStagedJournalRun, commitStagedJournalRun, runJournalImport, type JournalImportRequest } from '@/api/provider-imports/run';

/**
 * Provides the mutation boundary for staging a prepared provider import and committing it
 */
export function useImportJournal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ request, signal, onStaged }: {
      request: JournalImportRequest;
      signal?: AbortSignal;
      onStaged?: (runId: string) => Promise<void>;
    }) => runJournalImport(request, signal, onStaged),
    onSuccess: () => {
      invalidateAppData(queryClient);
    },
  });
}

/**
 * Provides the boundary for asking whether a provider import's unanswered commit landed
 *
 * A mutation rather than a query, since it is asked once for one run on the user's behalf and its
 * answer is only ever read by the import that asked. An answer that the commit landed refreshes the
 * app's data the way the commit itself would have
 */
export function useCheckStagedJournalImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, signal }: { runId: string; signal?: AbortSignal }) => checkStagedJournalRun(runId, signal),
    onSuccess: () => {
      invalidateAppData(queryClient);
    },
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
  });
}
