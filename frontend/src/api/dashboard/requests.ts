import { authenticatedFetch } from '@/api/client';
import { buildQueryString } from '@/api/utils/queryString';
import type {
  CreditUtilizationResponse,
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
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchDashboardCredit(signal?: AbortSignal) {
  return authenticatedFetch<CreditWidgetResponse>('/dashboard/credit', { signal });
}

/**
 * Fetches the credit totals the dashboard credit widget shows, counting only the accounts the user chose
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchDashboardCreditUtilization(signal?: AbortSignal) {
  return authenticatedFetch<CreditUtilizationResponse>('/dashboard/credit-utilization', { signal });
}

/**
 * Saves the credit accounts left out of the dashboard credit widget and returns the widget's new data
 */
export function replaceCreditExcludedAccounts(accountIds: string[]) {
  return authenticatedFetch<CreditUtilizationResponse>('/dashboard/credit-utilization/excluded-accounts', {
    method: 'PUT',
    body: JSON.stringify({ account_ids: accountIds }),
  });
}

/**
 * Fetches dashboard net worth history for a rolling day window
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchDashboardNetWorth(windowDays = 90, signal?: AbortSignal) {
  return authenticatedFetch<NetWorthWidgetResponse>(
    `/dashboard/net-worth${buildQueryString({ window_days: windowDays })}`,
    { signal },
  );
}

/**
 * Fetches dashboard savings-rate history
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchDashboardSavingsRate(signal?: AbortSignal) {
  return authenticatedFetch<SavingsRateWidgetResponse>('/dashboard/savings-rate', { signal });
}

/**
 * Fetches recent dashboard transactions for a rolling day window
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchDashboardRecentActivity(windowDays = 90, signal?: AbortSignal) {
  return authenticatedFetch<RecentActivityWidgetResponse>(
    `/dashboard/recent-activity${buildQueryString({ window_days: windowDays })}`,
    { signal },
  );
}

/**
 * Fetches cumulative spending comparison data for a calendar range
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchSpendingComparison(range: SpendingRange, signal?: AbortSignal) {
  return authenticatedFetch<SpendingComparisonResponse>(
    `/dashboard/spending-comparison${buildQueryString({ range })}`,
    { signal },
  );
}

/**
 * Fetches category-level dashboard spending breakdown for a calendar range
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchSpendingBreakdown(range: SpendingRange, signal?: AbortSignal) {
  return authenticatedFetch<SpendingBreakdownResponse>(
    `/dashboard/spending-breakdown${buildQueryString({ range })}`,
    { signal },
  );
}
