import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateAppData } from '@/api/cache/invalidation';
import { invalidateBudgetActivity } from '@/api/cache/updates/budgets';
import { importFireflyTransactionsInBatches } from '@/api/dataImports/batching';
import { postFireflyBudgetImport } from '@/api/dataImports/requests';

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
