import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateAppData } from '@/api/cache/invalidation';
import { importFireflyTransactionsInBatches } from '@/api/dataImports/batching';

/**
 * Provides the mutation boundary for uploading prepared Firefly III import payloads
 */
export function useImportFireflyTransactions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importFireflyTransactionsInBatches,
    onSuccess: () => {
      invalidateAppData(queryClient);
    },
  });
}
