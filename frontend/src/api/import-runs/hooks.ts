import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invalidateAppData } from '@/api/cache/invalidation';
import { lastImportKeys } from '@/api/cache/queryKeys';
import { fetchLastImport, undoImportRun } from '@/api/import-runs/requests';
import { ImportRunError } from '@/api/import-runs/run';
import { useAuth } from '@/hooks/useAuth';

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
      if (!(error instanceof ImportRunError) || error.phase !== 'commit') return;
      invalidateAppData(queryClient);
    },
  });
}

/**
 * Reads the last saved import while it can still be undone
 *
 * Read again every time the Imports page opens, since any change made elsewhere ends the undo
 */
export function useLastImport() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: lastImportKeys.all,
    queryFn: fetchLastImport,
    enabled: !!accessToken,
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

/**
 * Undoes the last import, then reads the ledger and the last import again
 *
 * Both are read again after a refusal too, since an undo whose answer was lost may have landed
 * and a second attempt then finds the import gone
 */
export function useUndoImportRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: undoImportRun,
    onSettled: () => {
      invalidateAppData(queryClient);
    },
  });
}
