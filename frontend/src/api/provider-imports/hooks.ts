import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateAppData } from '@/api/cache/invalidation';
import { commitStagedJournalRun, runJournalImport, type JournalImportRequest } from '@/api/provider-imports/run';

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
