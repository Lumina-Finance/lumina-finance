import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateAppData } from '@/api/cache/invalidation';
import { importTransactionsInBatches } from '@/api/transaction-imports/batching';

/**
 * Provides the mutation boundary for uploading prepared transaction import payloads
 */
export function useImportTransactions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importTransactionsInBatches,
    onSuccess: () => {
      invalidateAppData(queryClient);
    },
  });
}
