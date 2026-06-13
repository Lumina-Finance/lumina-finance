import type { AccountsOverview } from '@/api/accounts'
import { useDashboardCredit, useDashboardSavingsRate } from '@/api/dashboard'
import { useRunway } from '@/api/user'
import type { AccountsMetricsViewModel } from '@/pages/accounts/types/accounts'
import {
  getCreditUsageMetric,
  getRunwayMetric,
  getSavingsRateMetric,
} from '@/pages/accounts/utils/accountMetrics'

/**
 * Fetches account-adjacent dashboard metrics and builds the accounts metric band view model
 */
export function useAccountsMetrics(
  rows: AccountsOverview[],
  displayCurrency: string,
): AccountsMetricsViewModel {
  const { data: dashboardCredit, isFetching: dashboardCreditLoading } = useDashboardCredit()
  const { data: dashboardSavingsRate, isFetching: dashboardSavingsRateLoading } = useDashboardSavingsRate()
  const { data: runway, isFetching: runwayLoading } = useRunway()

  return {
    savingsRate: getSavingsRateMetric(dashboardSavingsRate, dashboardSavingsRateLoading),
    creditUsage: getCreditUsageMetric(rows, dashboardCredit, dashboardCreditLoading),
    runway: getRunwayMetric(runway, runwayLoading, displayCurrency),
  }
}
