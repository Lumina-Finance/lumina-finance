import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { authenticatedFetch } from '@/api/client';
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
}

export interface CreateBudgetPayload {
  baseBudgetId: string;
  period_start: string;
  overall_limit: number;
}

function createBaseBudget(payload: CreateBaseBudgetPayload) {
  return authenticatedFetch<BaseBudget>('/base-budgets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

function createBudgetInstance({ baseBudgetId, ...payload }: CreateBudgetPayload) {
  return authenticatedFetch<Budget>(`/base-budgets/${baseBudgetId}/budgets`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

function listBaseBudgets() {
  return authenticatedFetch<BaseBudget[]>('/base-budgets');
}

function listBudgets() {
  return authenticatedFetch<Budget[]>('/budgets');
}

function getBudgetUtilization(budgetId: string) {
  return authenticatedFetch<BudgetUtilization>(`/budgets/${budgetId}/utilization`);
}

export function useBaseBudgets() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: budgetKeys.baseBudgets(),
    queryFn: listBaseBudgets,
    enabled: !!accessToken,
    staleTime: 5 * 60 * 1000,
  });
}

export function useBudgets() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: budgetKeys.periods(),
    queryFn: listBudgets,
    enabled: !!accessToken,
    staleTime: 5 * 60 * 1000,
  });
}

export function useBudgetUtilizations(budgetIds: string[]) {
  const { accessToken } = useAuth();
  return useQueries({
    queries: budgetIds.map((budgetId) => ({
      queryKey: budgetKeys.utilization(budgetId),
      queryFn: () => getBudgetUtilization(budgetId),
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
      queryClient.invalidateQueries({ queryKey: budgetKeys.baseBudgets(), exact: true });
    },
  });
}

export function useCreateBudgetInstance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createBudgetInstance,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.periods(), exact: true });
    },
  });
}
