import { useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { authenticatedFetch } from '@/api/client';
import { invalidateBudgets, invalidateDashboardBudgets } from '@/api/cacheInvalidation';
import type { FxStatus } from '@/api/dashboard';
import { budgetKeys } from '@/api/queryKeys';
import { useAuth } from '@/hooks/useAuth';

export type RecurrenceFreq = 'weekly' | 'monthly' | 'yearly';

export interface BaseBudget {
  id: string;
  owner_id: string | null;
  group_id: string | null;
  name: string;
  currency: string;
  recurrence_freq: RecurrenceFreq;
  instance_length: number;
  recurrence_weekday: number | null;
  recurrence_dom: number | null;
  recurrence_month: number | null;
  recurs: boolean;
  created_at: string;
  category_ids: string[];
}

export interface Budget {
  id: string;
  base_budget_id: string;
  period_start: string;
  period_end: string;
  overall_limit: number;
  created_at: string;
  base_budget: BaseBudget;
}

export interface BudgetCategoryUtilization {
  category_id: string;
  spent: number;
}

export interface BudgetUtilization {
  budget_id: string;
  period_start: string;
  period_end: string;
  overall_limit: number;
  total_spent: number;
  categories: BudgetCategoryUtilization[];
  fx_status: FxStatus;
}

export interface LatestBudgetUtilization extends BudgetUtilization {
  base_budget_id: string;
  name: string;
  currency: string;
}

export interface CreateBaseBudgetPayload {
  name: string;
  currency: string;
  recurrence_freq: RecurrenceFreq;
  instance_length: number;
  recurrence_weekday: number | null;
  recurrence_dom: number | null;
  recurrence_month: number | null;
  recurs: boolean;
  category_ids: string[];
  period_start?: string;
  overall_limit?: number;
}

export interface CreateBudgetPayload {
  baseBudgetId: string;
  period_start: string;
  overall_limit: number;
}

export interface UpdateBaseBudgetPayload {
  id: string;
  patch: {
    name?: string;
    recurs?: boolean;
    category_ids?: string[];
  };
}

export interface UpdateBudgetPayload {
  id: string;
  patch: {
    overall_limit?: number;
  };
}

/**
 * Creates a base budget and optional first budget period
 */
export function createBaseBudget(payload: CreateBaseBudgetPayload) {
  return authenticatedFetch<BaseBudget>('/base-budgets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Creates a budget period under a base budget
 */
export function createBudgetInstance({ baseBudgetId, ...payload }: CreateBudgetPayload) {
  return authenticatedFetch<Budget>(`/base-budgets/${baseBudgetId}/budgets`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Fetches base budget definitions
 */
export function fetchBaseBudgets() {
  return authenticatedFetch<BaseBudget[]>('/base-budgets');
}

/**
 * Fetches budget periods
 */
export function fetchBudgets() {
  return authenticatedFetch<Budget[]>('/budgets');
}

/**
 * Fetches utilization for one budget period
 */
export function fetchBudgetUtilization(budgetId: string) {
  return authenticatedFetch<BudgetUtilization>(`/budgets/${budgetId}/utilization`);
}

/**
 * Fetches latest utilization for each active base budget
 */
export function fetchLatestBudgetUtilizations() {
  return authenticatedFetch<LatestBudgetUtilization[]>('/budgets/latest-utilizations');
}

/**
 * Deletes a base budget and its periods
 */
export function deleteBaseBudget(baseBudgetId: string) {
  return authenticatedFetch<void>(`/base-budgets/${baseBudgetId}`, {
    method: 'DELETE',
  });
}

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * Updates mutable base budget fields
 */
export function updateBaseBudget({ id, patch }: UpdateBaseBudgetPayload) {
  return authenticatedFetch<BaseBudget>(`/base-budgets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/**
 * Updates mutable budget period fields
 */
export function updateBudget({ id, patch }: UpdateBudgetPayload) {
  return authenticatedFetch<Budget>(`/budgets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/**
 * Invalidates budget views after budget mutations change dashboard rollups
 */
function invalidateBudgetActivity(queryClient: QueryClient) {
  invalidateBudgets(queryClient);
  invalidateDashboardBudgets(queryClient);
}

export function useBaseBudgets() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: budgetKeys.baseBudgets(),
    queryFn: fetchBaseBudgets,
    enabled: !!accessToken,
    staleTime: 5 * 60 * 1000,
  });
}

export function useBudgets() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: budgetKeys.periods(),
    queryFn: fetchBudgets,
    enabled: !!accessToken,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLatestBudgetUtilizations() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: budgetKeys.latestUtilizations(),
    queryFn: fetchLatestBudgetUtilizations,
    enabled: !!accessToken,
    staleTime: 5 * 60 * 1000,
  });
}

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

export function useCreateBaseBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createBaseBudget,
    onSuccess: () => {
      invalidateBudgetActivity(queryClient);
    },
  });
}

export function useCreateBudgetInstance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createBudgetInstance,
    onSuccess: () => {
      invalidateBudgetActivity(queryClient);
    },
  });
}

export function useDeleteBaseBudget({ minimumPendingMs = 0 }: { minimumPendingMs?: number } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (baseBudgetId: string) => {
      const minimumPending = delay(minimumPendingMs);
      try {
        const result = await deleteBaseBudget(baseBudgetId);
        await minimumPending;
        return result;
      } catch (error) {
        await minimumPending;
        throw error;
      }
    },
    onSuccess: () => {
      invalidateBudgetActivity(queryClient);
    },
  });
}

export function useUpdateBaseBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateBaseBudget,
    onSuccess: () => {
      invalidateBudgetActivity(queryClient);
    },
  });
}

export function useUpdateBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateBudget,
    onSuccess: () => {
      invalidateBudgetActivity(queryClient);
    },
  });
}
