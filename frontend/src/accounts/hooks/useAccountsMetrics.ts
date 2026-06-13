import type { AccountsOverview } from '@/api/accounts'
import type { FxStatus } from '@/api/shared/fx'
import { useDashboardCredit, useDashboardSavingsRate } from '@/api/dashboard'
import { useRunway } from '@/api/user'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  RUNWAY_BAND_STYLE,
  RUNWAY_TARGET_MONTHS,
  formatCompactRunway,
  formatRunwayBasis,
  runwayBand,
} from '@/utils/runway'

export interface AccountsMetricsViewModel {
  savingsRate: {
    value: number | null
    hasExpenses: boolean
    isLoading: boolean
    net: number
    income: number
    progress: number
    color: string
    fxStatus: FxStatus | undefined
  }
  creditUsage: {
    hasCreditAccounts: boolean
    hasCreditLimits: boolean
    hasCreditData: boolean
    isLoading: boolean
    utilization: number
    totalUsed: number
    totalLimit: number
    color: string
    fxStatus: FxStatus | undefined
  }
  runway: {
    label: string
    style: { bg: string; fg: string; label: string } | null
    fxStatus: FxStatus | undefined
    isLoading: boolean
    progress: number
    caption: string
    months: number | null
  }
}

export function useAccountsMetrics(
  rows: AccountsOverview[],
  displayCurrency: string,
): AccountsMetricsViewModel {
  const { data: dashboardCredit, isFetching: dashboardCreditLoading } = useDashboardCredit()
  const { data: dashboardSavingsRate, isFetching: dashboardSavingsRateLoading } = useDashboardSavingsRate()
  const { data: runway, isFetching: runwayLoading } = useRunway()

  const revolvingAccounts = rows.filter((account) => account.account_kind === 'revolving')
  const creditAccountsWithLimits = revolvingAccounts.filter((account) => account.credit_limit !== null)
  const hasCreditAccounts = revolvingAccounts.length > 0
  const hasCreditLimits = creditAccountsWithLimits.length > 0
  const totalCreditUsed = dashboardCredit?.credit_used ?? 0
  const totalCreditLimit = dashboardCredit?.credit_limit_total ?? 0
  const hasCreditData = Boolean(dashboardCredit) && totalCreditLimit > 0
  const creditUtilization =
    totalCreditLimit > 0 ? Math.round((totalCreditUsed / totalCreditLimit) * 100) : 0
  const creditUtilColor = dashboardCreditLoading || !hasCreditData
    ? 'var(--app-text-subtle)'
    : creditUtilization <= 30
      ? 'var(--app-positive)'
      : creditUtilization <= 70
        ? 'var(--app-accent)'
        : 'var(--app-negative)'

  const runwayMonths = runway?.months ?? null
  const runwayBandKey = runwayBand(runwayMonths, runway?.thresholds)
  const runwayStyle = runwayBandKey ? RUNWAY_BAND_STYLE[runwayBandKey] : null
  const runwayProgress =
    runwayMonths === null ? 0 : Math.min((runwayMonths / RUNWAY_TARGET_MONTHS) * 100, 100)
  const runwayCaption =
    !runway
      ? ''
      : runway.reason === 'no_accounts'
        ? 'Choose accounts in Settings'
        : runway.reason === 'insufficient_history'
          ? 'Need 1+ month of net expense data'
          : `${formatCurrency(runway.avg_monthly_expense, displayCurrency)}/mth · ${formatRunwayBasis(runway.months_covered)}`

  const savingsRatePeriod = dashboardSavingsRate?.savings_rate_history.at(-1)
  const savingsRateIncome = savingsRatePeriod?.income ?? 0
  const savingsRateExpenses = savingsRatePeriod?.expenses ?? 0
  const savingsRateNet = savingsRateIncome - savingsRateExpenses
  const savingsRate =
    savingsRateIncome > 0 ? Math.round((savingsRateNet / savingsRateIncome) * 100) : null
  const savingsRateHasExpenses = savingsRateExpenses > 0
  const savingsRateProgress =
    dashboardSavingsRateLoading
      ? 0
      : savingsRate === null
        ? savingsRateHasExpenses ? 100 : 0
        : savingsRate <= 0
          ? 100
          : Math.min(savingsRate, 100)
  const savingsRateColor =
    dashboardSavingsRateLoading
      ? 'var(--app-text-subtle)'
      : savingsRate !== null
      ? savingsRate >= 20
        ? 'var(--app-positive)'
        : savingsRate >= 10
          ? 'var(--app-accent)'
          : 'var(--app-negative)'
      : savingsRateHasExpenses
        ? 'var(--app-negative)'
        : 'var(--app-text-subtle)'

  return {
    savingsRate: {
      value: savingsRate,
      hasExpenses: savingsRateHasExpenses,
      isLoading: dashboardSavingsRateLoading,
      net: savingsRateNet,
      income: savingsRateIncome,
      progress: savingsRateProgress,
      color: savingsRateColor,
      fxStatus: dashboardSavingsRate?.fx_status,
    },
    creditUsage: {
      hasCreditAccounts,
      hasCreditLimits,
      hasCreditData,
      isLoading: dashboardCreditLoading,
      utilization: creditUtilization,
      totalUsed: totalCreditUsed,
      totalLimit: totalCreditLimit,
      color: creditUtilColor,
      fxStatus: dashboardCredit?.fx_status,
    },
    runway: {
      label: formatCompactRunway(runwayMonths),
      style: runwayStyle,
      fxStatus: runway?.fx_status,
      isLoading: runwayLoading,
      progress: runwayProgress,
      caption: runwayCaption,
      months: runwayMonths,
    },
  }
}
