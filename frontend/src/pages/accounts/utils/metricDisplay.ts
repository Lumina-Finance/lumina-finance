import type { AccountsMetricsViewModel } from '@/pages/accounts/types/accounts'
import type { Currency } from '@/api/currency'
import { formatCurrency } from '@/utils/formatCurrency'

export type MetricDisplay = {
  value: string
  caption: string
}

/**
 * Formats savings-rate values and empty states for the accounts metrics band
 */
export function getSavingsRateDisplay(
  savingsRate: AccountsMetricsViewModel['savingsRate'],
  displayCurrency: string,
  currencies: Currency[],
): MetricDisplay {
  const value =
    !savingsRate.isLoading && savingsRate.value !== null
      ? `${savingsRate.value}%`
      : savingsRate.hasExpenses
        ? '−∞%'
        : 'N/A'
  const caption = savingsRate.isLoading
    ? 'Loading savings rate'
    : savingsRate.value !== null
      ? `${formatCurrency(savingsRate.net, displayCurrency, currencies)} of ${formatCurrency(savingsRate.income, displayCurrency, currencies)} this month`
      : savingsRate.hasExpenses
        ? 'No income this month'
        : 'No data this month'

  return { value, caption }
}

/**
 * Formats credit usage values and explains why usage may not be available
 */
export function getCreditUsageDisplay(
  creditUsage: AccountsMetricsViewModel['creditUsage'],
  displayCurrency: string,
  currencies: Currency[],
): MetricDisplay {
  const value =
    !creditUsage.isLoading && creditUsage.hasCreditData ? `${creditUsage.utilization}%` : 'N/A'
  const caption = creditUsage.isLoading
    ? 'Loading credit totals'
    : creditUsage.hasCreditData
      ? `${formatCurrency(creditUsage.totalUsed, displayCurrency, currencies)} of ${formatCurrency(creditUsage.totalLimit, displayCurrency, currencies)}`
      : creditUsage.hasCreditLimits && creditUsage.fxStatus?.state !== 'none'
        ? 'FX unavailable'
        : creditUsage.hasCreditAccounts
          ? 'No credit limits set'
          : 'No revolving credit accounts'

  return { value, caption }
}
