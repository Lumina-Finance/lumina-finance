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
