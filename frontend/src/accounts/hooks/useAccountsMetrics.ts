import type { AccountsOverview } from '@/api/accounts'
import { useDashboardSavingsRate } from '@/api/dashboard'
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
    net: number
    income: number
    color: string
  }
  creditUsage: {
    hasCreditAccounts: boolean
    hasCreditData: boolean
    utilization: number
    totalUsed: number
    totalLimit: number
    color: string
  }
  runway: {
    label: string
    style: { bg: string; fg: string; label: string } | null
    progress: number
    caption: string
    months: number | null
  }
}

export function useAccountsMetrics(
  rows: AccountsOverview[],
  displayCurrency: string,
): AccountsMetricsViewModel {
  const { data: dashboardSavingsRate } = useDashboardSavingsRate()
  const { data: runway } = useRunway()

  // Revolving balances are signed from the user's perspective: negative means
  // debt, positive means stored credit. Stored credit should not offset usage.
  const revolvingAccounts = rows.filter((account) => account.account_kind === 'revolving')
  const creditAccountsWithLimits = revolvingAccounts.filter((account) => account.credit_limit !== null)
  const hasCreditAccounts = revolvingAccounts.length > 0
  const hasCreditData = creditAccountsWithLimits.length > 0
  const totalCreditUsed = creditAccountsWithLimits.reduce(
    (sum, account) => sum + Math.max(-account.current_balance, 0),
    0,
  )
  const totalCreditLimit = creditAccountsWithLimits.reduce(
    (sum, account) => sum + (account.credit_limit ?? 0),
    0,
  )
  const creditUtilization =
    totalCreditLimit > 0 ? Math.round((totalCreditUsed / totalCreditLimit) * 100) : 0
  const creditUtilColor = !hasCreditData
    ? 'var(--app-text-subtle)'
    : creditUtilization <= 30
      ? 'var(--app-positive)'
      : creditUtilization <= 70
        ? 'var(--app-accent)'
        : 'var(--app-negative)'

  const runwayMonths = runway?.months ?? null
  const runwayBandKey = runwayBand(runwayMonths)
  const runwayStyle = runwayBandKey ? RUNWAY_BAND_STYLE[runwayBandKey] : null
  const runwayProgress =
    runwayMonths === null ? 0 : Math.min((runwayMonths / RUNWAY_TARGET_MONTHS) * 100, 100)
  const runwayCaption =
    !runway
      ? ''
      : runway.reason === 'no_accounts'
        ? 'Choose accounts in Settings'
        : runway.reason === 'insufficient_history'
          ? 'Need 1+ month of expense data'
          : `${formatCurrency(runway.avg_monthly_expense, displayCurrency)}/mth · ${formatRunwayBasis(runway.months_covered)}`

  const savingsRatePeriod = dashboardSavingsRate?.savings_rate_history.at(-1)
  const savingsRateIncome = savingsRatePeriod?.income ?? 0
  const savingsRateExpenses = savingsRatePeriod?.expenses ?? 0
  const savingsRateNet = savingsRateIncome - savingsRateExpenses
  const savingsRate =
    savingsRateIncome > 0 ? Math.round((savingsRateNet / savingsRateIncome) * 100) : null
  const savingsRateHasExpenses = savingsRateExpenses > 0
  const savingsRateColor =
    savingsRate !== null
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
      net: savingsRateNet,
      income: savingsRateIncome,
      color: savingsRateColor,
    },
    creditUsage: {
      hasCreditAccounts,
      hasCreditData,
      utilization: creditUtilization,
      totalUsed: totalCreditUsed,
      totalLimit: totalCreditLimit,
      color: creditUtilColor,
    },
    runway: {
      label: formatCompactRunway(runwayMonths),
      style: runwayStyle,
      progress: runwayProgress,
      caption: runwayCaption,
      months: runwayMonths,
    },
  }
}
