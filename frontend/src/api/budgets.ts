import { useMutation } from '@tanstack/react-query';
import { authenticatedFetch } from '@/api/client';

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

export function useCreateBaseBudget() {
  return useMutation({
    mutationFn: createBaseBudget,
  });
}

export function useCreateBudgetInstance() {
  return useMutation({
    mutationFn: createBudgetInstance,
  });
}
