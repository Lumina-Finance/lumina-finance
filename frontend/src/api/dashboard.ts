import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { authenticatedFetch } from '@/api/client';
import type { Transaction } from '@/api/transactions';

// ── Types (mirror backend schemas) ──

export interface MonthlyIncomeExpense {
  // First-of-month calendar date (YYYY-MM-DD).
  month: string;
  income: number;
  expenses: number;
}

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

  recurring_expenses_estimate: number | null;
  savings_rate_history: MonthlyIncomeExpense[];

  upcoming_bills: unknown[] | null;
  runway_months: number | null;

  recent_transactions: Transaction[];
  active_budgets: ActiveBudgetSummary[];
  transaction_window_days: number;
}

// ── Spending comparison ──

export type SpendingRange = 'WTD' | 'MTD' | 'QTD' | 'YTD';

export interface CategoryBreakdownEntry {
  category_id: string;
  name: string;
  amount: number;
}

export interface SpendingBreakdownResponse {
  range: SpendingRange;
  expense: CategoryBreakdownEntry[];
  income: CategoryBreakdownEntry[];
}

export interface SpendingComparisonResponse {
  range: SpendingRange;
  // X-axis labels covering the full current period.
  slot_labels: string[];
  // Cumulative positive minor-unit totals; each array contains only the slots
  // with real data (current stops at today, previous stops at the prior
  // period's last day). The frontend zips by index against slot_labels.
  current: number[];
  previous: number[];
}

// ── Hooks ──

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

export function useSpendingComparison(range: SpendingRange) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ['spending-comparison', range],
    queryFn: () =>
      authenticatedFetch<SpendingComparisonResponse>(
        `/dashboard/spending-comparison?range=${range}`,
      ),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

export function useSpendingBreakdown(range: SpendingRange) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ['spending-breakdown', range],
    queryFn: () =>
      authenticatedFetch<SpendingBreakdownResponse>(
        `/dashboard/spending-breakdown?range=${range}`,
      ),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}
