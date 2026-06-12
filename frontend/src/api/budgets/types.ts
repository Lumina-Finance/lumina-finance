import type { FxStatus } from '@/api/dashboard';

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
