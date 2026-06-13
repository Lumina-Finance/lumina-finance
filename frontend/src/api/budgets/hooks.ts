import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { invalidateBudgetActivity } from '@/api/cache/budgets';
import {
  createBaseBudget,
  createBudgetInstance,
  deleteBaseBudget,
  fetchBaseBudgets,
  fetchBudgetUtilization,
  fetchBudgets,
  fetchLatestBudgetUtilizations,
  updateBaseBudget,
  updateBudget,
} from '@/api/budgets/requests';
import { runWithMinimumPendingTime } from '@/api/utils/mutationFeedback';
import { budgetKeys } from '@/api/cache/queryKeys';
import { useAuth } from '@/hooks/useAuth';

/**
 * Reads base budget definitions
 */
export function useBaseBudgets() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: budgetKeys.baseBudgets(),
    queryFn: fetchBaseBudgets,
    enabled: !!accessToken,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Reads budget periods
 */
export function useBudgets() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: budgetKeys.periods(),
    queryFn: fetchBudgets,
    enabled: !!accessToken,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Reads latest utilization for each active base budget
 */
export function useLatestBudgetUtilizations() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: budgetKeys.latestUtilizations(),
    queryFn: fetchLatestBudgetUtilizations,
    enabled: !!accessToken,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Reads utilization for every requested budget period
 */
export function useBudgetUtilizations(budgetIds: string[]) {
  const { accessToken } = useAuth();
  return useQueries({
    queries: budgetIds.map((budgetId) => ({
      queryKey: budgetKeys.utilization(budgetId),
      queryFn: () => fetchBudgetUtilization(budgetId),
      enabled: !!accessToken,
      staleTime: 5 * 60 * 1000,
    })),
  });
}

/**
 * Creates base budgets and refreshes budget rollups
 */
export function useCreateBaseBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createBaseBudget,
    onSuccess: () => {
      invalidateBudgetActivity(queryClient);
    },
  });
}

/**
 * Creates budget periods and refreshes budget rollups
 */
export function useCreateBudgetInstance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createBudgetInstance,
    onSuccess: () => {
      invalidateBudgetActivity(queryClient);
    },
  });
}

/**
 * Deletes base budgets and refreshes budget rollups after feedback has displayed
 */
export function useDeleteBaseBudget({ minimumPendingMs = 0 }: { minimumPendingMs?: number } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (baseBudgetId: string) =>
      runWithMinimumPendingTime(minimumPendingMs, () => deleteBaseBudget(baseBudgetId)),
    onSuccess: () => {
      invalidateBudgetActivity(queryClient);
    },
  });
}

/**
 * Updates base budgets and refreshes budget rollups
 */
export function useUpdateBaseBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateBaseBudget,
    onSuccess: () => {
      invalidateBudgetActivity(queryClient);
    },
  });
}

/**
 * Updates budget periods and refreshes budget rollups
 */
export function useUpdateBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateBudget,
    onSuccess: () => {
      invalidateBudgetActivity(queryClient);
    },
  });
}
