import type { AccountsOverview } from '@/api/accounts'
import type {
  CreditWidgetResponse,
  SavingsRateWidgetResponse,
} from '@/api/dashboard'
import type { RunwayResult } from '@/api/user'
import type { AccountsMetricsViewModel } from '@/pages/accounts/types/accounts'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  RUNWAY_BAND_STYLE,
  RUNWAY_TARGET_MONTHS,
  formatCompactRunway,
  formatRunwayBasis,
  runwayBand,
} from '@/utils/runway'

/**
 * Builds the savings rate metric from the most recent dashboard savings period
 */
export function getSavingsRateMetric(
  dashboardSavingsRate: SavingsRateWidgetResponse | undefined,
  isLoading: boolean,
): AccountsMetricsViewModel['savingsRate'] {
  const savingsRatePeriod = dashboardSavingsRate?.savings_rate_history.at(-1)
  const income = savingsRatePeriod?.income ?? 0
  const expenses = savingsRatePeriod?.expenses ?? 0
  const net = income - expenses
  const value = income > 0 ? Math.round((net / income) * 100) : null
  const hasExpenses = expenses > 0
  const progress =
    isLoading
      ? 0
      : value === null
        ? hasExpenses ? 100 : 0
        : value <= 0
          ? 100
          : Math.min(value, 100)
  const color =
    isLoading
      ? 'var(--app-text-subtle)'
      : value !== null
      ? value >= 20
        ? 'var(--app-positive)'
        : value >= 10
          ? 'var(--app-accent)'
          : 'var(--app-negative)'
      : hasExpenses
        ? 'var(--app-negative)'
        : 'var(--app-text-subtle)'

  return {
    value,
    hasExpenses,
    isLoading,
    net,
    income,
    progress,
    color,
    fxStatus: dashboardSavingsRate?.fx_status,
  }
}

/**
 * Builds credit usage from dashboard totals while preserving account-list empty states
 */
export function getCreditUsageMetric(
  rows: AccountsOverview[],
  dashboardCredit: CreditWidgetResponse | undefined,
  isLoading: boolean,
): AccountsMetricsViewModel['creditUsage'] {
  const revolvingAccounts = rows.filter((account) => account.account_kind === 'revolving')
  const creditAccountsWithLimits = revolvingAccounts.filter((account) => account.credit_limit !== null)
  const totalUsed = dashboardCredit?.credit_used ?? 0
  const totalLimit = dashboardCredit?.credit_limit_total ?? 0
  const hasCreditData = Boolean(dashboardCredit) && totalLimit > 0
  const utilization = totalLimit > 0 ? Math.round((totalUsed / totalLimit) * 100) : 0
  const color = isLoading || !hasCreditData
    ? 'var(--app-text-subtle)'
    : utilization <= 30
      ? 'var(--app-positive)'
      : utilization <= 70
        ? 'var(--app-accent)'
        : 'var(--app-negative)'

  return {
    hasCreditAccounts: revolvingAccounts.length > 0,
    hasCreditLimits: creditAccountsWithLimits.length > 0,
    hasCreditData,
    isLoading,
    utilization,
    totalUsed,
    totalLimit,
    color,
    fxStatus: dashboardCredit?.fx_status,
  }
}

/**
 * Builds the runway metric label, progress, and caption from the latest runway result
 */
export function getRunwayMetric(
  runway: RunwayResult | undefined,
  isLoading: boolean,
  displayCurrency: string,
): AccountsMetricsViewModel['runway'] {
  const months = runway?.months ?? null
  const bandKey = runwayBand(months, runway?.thresholds)
  const style = bandKey ? RUNWAY_BAND_STYLE[bandKey] : null
  const progress = months === null ? 0 : Math.min((months / RUNWAY_TARGET_MONTHS) * 100, 100)
  const caption =
    !runway
      ? ''
      : runway.reason === 'no_accounts'
        ? 'Choose accounts in Settings'
        : runway.reason === 'insufficient_history'
          ? 'Need 1+ month of net expense data'
          : `${formatCurrency(runway.avg_monthly_expense, displayCurrency)}/mth · ${formatRunwayBasis(runway.months_covered)}`

  return {
    label: formatCompactRunway(months),
    style,
    fxStatus: runway?.fx_status,
    isLoading,
    progress,
    caption,
    months,
  }
}
