import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { authenticatedFetch } from '@/api/client';
import { dashboardKeys } from '@/api/queryKeys';
import { buildQueryString } from '@/api/queryString';
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
  fx_status: FxStatus;
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
  fx_status: FxStatus;
}

// ── Hooks ──

/**
 * Fetches dashboard credit utilization data
 */
export function fetchDashboardCredit() {
  return authenticatedFetch<CreditWidgetResponse>('/dashboard/credit');
}

/**
 * Fetches dashboard net worth history for a rolling day window
 */
export function fetchDashboardNetWorth(windowDays = 90) {
  return authenticatedFetch<NetWorthWidgetResponse>(
    `/dashboard/net-worth${buildQueryString({ window_days: windowDays })}`,
  );
}

/**
 * Fetches dashboard savings-rate history
 */
export function fetchDashboardSavingsRate() {
  return authenticatedFetch<SavingsRateWidgetResponse>('/dashboard/savings-rate');
}

/**
 * Fetches recent dashboard transactions for a rolling day window
 */
export function fetchDashboardRecentActivity(windowDays = 90) {
  return authenticatedFetch<RecentActivityWidgetResponse>(
    `/dashboard/recent-activity${buildQueryString({ window_days: windowDays })}`,
  );
}

/**
 * Fetches cumulative spending comparison data for a calendar range
 */
export function fetchSpendingComparison(range: SpendingRange) {
  return authenticatedFetch<SpendingComparisonResponse>(
    `/dashboard/spending-comparison${buildQueryString({ range })}`,
  );
}

/**
 * Fetches category-level dashboard spending breakdown for a calendar range
 */
export function fetchSpendingBreakdown(range: SpendingRange) {
  return authenticatedFetch<SpendingBreakdownResponse>(
    `/dashboard/spending-breakdown${buildQueryString({ range })}`,
  );
}

export function useDashboardCredit() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.credit(),
    queryFn: fetchDashboardCredit,
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

export function useDashboardNetWorth(windowDays = 90) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.netWorth(windowDays),
    queryFn: () => fetchDashboardNetWorth(windowDays),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

export function useDashboardSavingsRate() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.savingsRate(),
    queryFn: fetchDashboardSavingsRate,
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

export function useDashboardRecentActivity(windowDays = 90) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.recentActivity(windowDays),
    queryFn: () => fetchDashboardRecentActivity(windowDays),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

export function useSpendingComparison(range: SpendingRange) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.spendingComparison(range),
    queryFn: () => fetchSpendingComparison(range),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

export function useSpendingBreakdown(range: SpendingRange) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.spendingBreakdown(range),
    queryFn: () => fetchSpendingBreakdown(range),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}
