import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { authenticatedFetch } from '@/api/client';
import { insightsKeys } from '@/api/queryKeys';

export interface InsightsPeriodGlanceResponse {
  income: number;
  expenses: number;
  net_worth_change: number;
  top_category_name?: string;
  top_category_share_pct?: number;
  biggest_change_name?: string;
  biggest_change_amount?: number;
  biggest_change_pct?: number;
}

export type InsightsFlowEntry = [string, number];

export interface InsightsIncomeExpenseFlowResponse {
  income_sources: InsightsFlowEntry[];
  expense_categories: InsightsFlowEntry[];
  income_outflows: InsightsFlowEntry[];
  expense_inflows: InsightsFlowEntry[];
  income_source_count: number;
  expense_category_count: number;
}

export function useInsightsPeriodGlance(fromDate: string, toDate: string, enabled = true) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: insightsKeys.periodGlance(fromDate, toDate),
    queryFn: () =>
      authenticatedFetch<InsightsPeriodGlanceResponse>(
        `/insights/period-glance?from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}`,
      ),
    enabled: !!accessToken && enabled && fromDate !== '' && toDate !== '',
    staleTime: 5 * 60 * 1000,
  });
}

export function useInsightsIncomeExpenseFlow(fromDate: string, toDate: string, enabled = true) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: insightsKeys.incomeExpenseFlow(fromDate, toDate),
    queryFn: () =>
      authenticatedFetch<InsightsIncomeExpenseFlowResponse>(
        `/insights/income-expense-flow?from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}`,
      ),
    enabled: !!accessToken && enabled && fromDate !== '' && toDate !== '',
    staleTime: 5 * 60 * 1000,
  });
}
