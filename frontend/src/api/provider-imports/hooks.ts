import { useImportRunMutation } from '@/api/import-runs/hooks';
import { commitStagedJournalRun, runJournalImport, type JournalImportRequest } from '@/api/provider-imports/run';

/**
 * Provides the mutation boundary for staging a prepared provider import and committing it
 */
export function useImportJournal() {
  return useImportRunMutation(({ request, signal, onStaged }: {
    request: JournalImportRequest;
    signal?: AbortSignal;
    onStaged?: () => Promise<void>;
  }) => runJournalImport(request, signal, onStaged));
}

/**
 * Provides the mutation boundary for committing a provider import that is already staged
 */
export function useCommitStagedJournalImport() {
  return useImportRunMutation(({ runId, signal }: { runId: string; signal?: AbortSignal }) =>
    commitStagedJournalRun(runId, signal));
}
