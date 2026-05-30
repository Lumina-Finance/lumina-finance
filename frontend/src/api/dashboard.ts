import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { authenticatedFetch } from '@/api/client';
import { dashboardKeys } from '@/api/queryKeys';
import type { Transaction } from '@/api/transactions';

// ── Types (mirror backend schemas) ──

export interface MonthlyIncomeExpense {
  // First-of-month calendar date (YYYY-MM-DD).
  month: string;
  income: number;
  expenses: number;
}

export interface CreditWidgetResponse {
  credit_limit_total: number;
  credit_used: number;
  fx_status: FxStatus;
}

export type FxState = 'none' | 'complete' | 'incomplete' | 'unavailable';

export interface FxRateIssue {
  base: string;
  quote: string;
}

export interface FxStatus {
  state: FxState;
  missing_pairs: FxRateIssue[];
}

export interface NetWorthWidgetResponse {
  current_net_worth: number;
  net_worth_history: number[];
  net_worth_window_days: number;
  fx_status: FxStatus;
}

export interface SavingsRateWidgetResponse {
  savings_rate_history: MonthlyIncomeExpense[];
  fx_status: FxStatus;
}

export interface RecentActivityWidgetResponse {
  recent_transactions: Transaction[];
  transaction_window_days: number;
}

// ── Spending comparison ──

export type SpendingRange = 'WTD' | 'MTD' | 'QTD' | 'YTD';
export type BreakdownCategoryKind = 'expense' | 'income';

export interface CategoryBreakdownEntry {
  category_id: string;
  name: string;
  category_kind: BreakdownCategoryKind;
  amount: number;
}

export interface SpendingBreakdownResponse {
  range: SpendingRange;
  expense: CategoryBreakdownEntry[];
  income: CategoryBreakdownEntry[];
  expense_total: number;
  income_total: number;
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

export function useDashboardCredit() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.credit(),
    queryFn: () => authenticatedFetch<CreditWidgetResponse>('/dashboard/credit'),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

export function useDashboardNetWorth(windowDays = 90) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.netWorth(windowDays),
    queryFn: () =>
      authenticatedFetch<NetWorthWidgetResponse>(
        `/dashboard/net-worth?window_days=${windowDays}`,
      ),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

export function useDashboardSavingsRate() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.savingsRate(),
    queryFn: () => authenticatedFetch<SavingsRateWidgetResponse>('/dashboard/savings-rate'),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

export function useDashboardRecentActivity(windowDays = 90) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.recentActivity(windowDays),
    queryFn: () =>
      authenticatedFetch<RecentActivityWidgetResponse>(
        `/dashboard/recent-activity?window_days=${windowDays}`,
      ),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

export function useSpendingComparison(range: SpendingRange) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.spendingComparison(range),
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
    queryKey: dashboardKeys.spendingBreakdown(range),
    queryFn: () =>
      authenticatedFetch<SpendingBreakdownResponse>(
        `/dashboard/spending-breakdown?range=${range}`,
      ),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}
