import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateAppData } from '@/api/cache/invalidation';
import { invalidateBudgetActivity } from '@/api/cache/updates/budgets';
import { importFireflyTransactionsInBatches } from '@/api/firefly-imports/batching';
import { postFireflyBudgetImport } from '@/api/firefly-imports/requests';

/**
 * Provides the mutation boundary for uploading prepared Firefly III import payloads
 */
export function useImportFireflyTransactions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importFireflyTransactionsInBatches,

    // Settled rather than success because a failure part way through the
    // batches leaves the earlier batches committed, and those rows must not
    // keep being served from stale caches
    onSettled: () => {
      invalidateAppData(queryClient);
    },
  });
}

/**
 * Creates Firefly III budgets with their limit histories and refreshes budget rollups
 */
export function useImportFireflyBudgets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: postFireflyBudgetImport,
    onSuccess: () => {
      invalidateBudgetActivity(queryClient);
    },
  });
}
