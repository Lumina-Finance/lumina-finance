import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateAppData } from '@/api/cache/invalidation';
import { commitStagedFireflyRun, runFireflyImport, type FireflyImportRequest } from '@/api/firefly-imports/run';

/**
 * Provides the mutation boundary for staging a prepared Firefly III import and committing it
 */
export function useImportFirefly() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ request, signal, onStaged }: {
      request: FireflyImportRequest;
      signal?: AbortSignal;
      onStaged?: () => Promise<void>;
    }) => runFireflyImport(request, signal, onStaged),
    onSuccess: () => {
      invalidateAppData(queryClient);
    },
  });
}

/**
 * Provides the mutation boundary for committing a Firefly III import that is already staged
 */
export function useCommitStagedFireflyImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, signal }: { runId: string; signal?: AbortSignal }) => commitStagedFireflyRun(runId, signal),
    onSuccess: () => {
      invalidateAppData(queryClient);
    },
  });
}
