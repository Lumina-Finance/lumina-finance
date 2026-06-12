import { authenticatedFetch } from '@/api/client';
import { buildQueryString } from '@/api/queryString';
import type {
  CreditWidgetResponse,
  NetWorthWidgetResponse,
  RecentActivityWidgetResponse,
  SavingsRateWidgetResponse,
  SpendingBreakdownResponse,
  SpendingComparisonResponse,
  SpendingRange,
} from '@/api/dashboard/types';

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
