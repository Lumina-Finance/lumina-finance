import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateAppData } from '@/api/cache/invalidation';
import { ImportRunError } from '@/api/import-runs/run';

/**
 * Provides the mutation boundary for any request that saves an import run
 *
 * The ledger is read again once a save lands, and also after a save that ended with no answer,
 * since it may have landed, so a user told to check their transactions sees them as they are. A
 * failure while uploading wrote nothing, so it leaves the ledger alone
 *
 * @param save - Uploads and saves an import, or saves one already uploaded
 */
export function useImportRunMutation<TVariables, TResponse>(save: (variables: TVariables) => Promise<TResponse>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: save,
    onSuccess: () => {
      invalidateAppData(queryClient);
    },
    onError: (error) => {
      if (error instanceof ImportRunError && error.phase === 'commit') invalidateAppData(queryClient);
    },
  });
}
