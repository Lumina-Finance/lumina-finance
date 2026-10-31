import type { AccountsOverview } from '@/api/accounts'
import { useDashboardCredit, useDashboardSavingsRate } from '@/api/dashboard'
import { useRunway } from '@/api/user'
import { isLoadingFirstAnswer } from '@/utils/queryLoading'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import type { AccountsMetricsViewModel } from '@/pages/accounts/types/accounts'
import { getCreditUsageMetric, getRunwayMetric, getSavingsRateMetric } from '@/pages/accounts/utils/accountMetrics'

/**
 * Fetches account-adjacent dashboard metrics and builds the accounts metric band view model
 */
export function useAccountsMetrics(rows: AccountsOverview[], displayCurrency: string): AccountsMetricsViewModel {
  const creditQuery = useDashboardCredit()
  const savingsRateQuery = useDashboardSavingsRate()
  const runwayQuery = useRunway()
  const { currencies } = useMoneyFormatters()

  return {
    savingsRate: getSavingsRateMetric(savingsRateQuery.data, isLoadingFirstAnswer(savingsRateQuery)),
    creditUsage: getCreditUsageMetric(rows, creditQuery.data, isLoadingFirstAnswer(creditQuery)),
    runway: getRunwayMetric(runwayQuery.data, isLoadingFirstAnswer(runwayQuery), displayCurrency, currencies),
  }
}
