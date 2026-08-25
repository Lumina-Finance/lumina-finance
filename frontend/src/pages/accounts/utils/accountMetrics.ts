import type { AccountsOverview } from '@/api/accounts'
import type {
  CreditWidgetResponse,
  SavingsRateWidgetResponse,
} from '@/api/dashboard'
import type { RunwayResult } from '@/api/user'
import type { Currency } from '@/api/currency'
import type { AccountsMetricsViewModel } from '@/pages/accounts/types/accounts'
import { formatCurrency } from '@/utils/formatCurrency'
import { getSavingsRateTier } from '@/utils/savingsRateTier'
import { getValueMarkColor, type ValueMarkTone } from '@/utils/valueMarkColor'
import {
  RUNWAY_BAND_STYLE,
  RUNWAY_TARGET_MONTHS,
  formatCompactRunway,
  formatRunwayBasis,
  runwayBand,
} from '@/utils/runway'

// Colour of the figure on a metric tile. A number needs more contrast against the tile than the
// bar under it does, so the two are not drawn from the same pair
const METRIC_TEXT_COLORS: Record<ValueMarkTone, string> = {
  positive: 'var(--app-positive)',
  accent: 'var(--app-accent)',
  negative: 'var(--app-negative)',
}

// What a tile shows before its figure arrives, and where there is no figure to show
const METRIC_UNSET_COLOR = 'var(--app-text-subtle)'

/**
 * Resolves the colour of a metric tile's figure, or the resting grey when it has none
 */
function getMetricTextColor(tone: ValueMarkTone | null) {
  return tone === null ? METRIC_UNSET_COLOR : METRIC_TEXT_COLORS[tone]
}

/**
 * Resolves the colour of a metric tile's bar, or the resting grey when it has no figure
 */
function getMetricBarColor(tone: ValueMarkTone | null) {
  return tone === null ? METRIC_UNSET_COLOR : getValueMarkColor(tone)
}

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
  // A month with no income and no expenses has no rate to show, so the tile stays grey rather than
  // taking the tier a null rate falls in
  const tone = isLoading
    ? null
    : value !== null
      ? getSavingsRateTier(value)
      : hasExpenses
        ? 'negative'
        : null

  return {
    value,
    hasExpenses,
    isLoading,
    net,
    income,
    progress,
    color: getMetricTextColor(tone),
    barColor: getMetricBarColor(tone),
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
  const tone = isLoading || !hasCreditData
    ? null
    : utilization <= 30
      ? 'positive'
      : utilization <= 70
        ? 'accent'
        : 'negative'

  return {
    hasCreditAccounts: revolvingAccounts.length > 0,
    hasCreditLimits: creditAccountsWithLimits.length > 0,
    hasCreditData,
    isLoading,
    utilization,
    totalUsed,
    totalLimit,
    color: getMetricTextColor(tone),
    barColor: getMetricBarColor(tone),
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
  currencies: Currency[],
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
          : `${formatCurrency(runway.avg_monthly_expense, displayCurrency, currencies)}/mth · ${formatRunwayBasis(runway.months_covered)}`

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
