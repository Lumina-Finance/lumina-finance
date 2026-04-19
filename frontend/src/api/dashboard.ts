import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { authenticatedFetch } from '@/api/client';
import type { Transaction } from '@/api/transactions';

// ── Types (mirror backend schemas) ──

export interface ActiveBudgetSummary {
  budget_id: string;
  base_budget_id: string;
  name: string;
  currency: string;
  period_start: string;
  period_end: string;
  overall_limit: number;
  total_spent: number;
}

export interface DashboardResponse {
  current_net_worth: number;
  net_worth_history: number[];
  net_worth_window_days: number;

  credit_limit_total: number;
  credit_used: number;

  current_month_cumulative: number[];
  historical_avg_cumulative: number[] | null;
  historical_months_averaged: number;

  recurring_expenses_estimate: number | null;
  savings_rate: number | null;

  upcoming_bills: unknown[] | null;
  runway_months: number | null;

  recent_transactions: Transaction[];
  active_budgets: ActiveBudgetSummary[];
  transaction_window_days: number;
}

// ── Hook ──

export function useDashboard(windowDays = 90) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ['dashboard', windowDays],
    queryFn: () =>
      authenticatedFetch<DashboardResponse>(`/dashboard?window_days=${windowDays}`),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}
