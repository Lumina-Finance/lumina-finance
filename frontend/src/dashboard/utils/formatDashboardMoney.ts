import { formatCurrency } from '@/utils/formatCurrency'
import { DASHBOARD_MONEY_RULES } from '@/dashboard/constants/moneyRules'
import { formatCompactMoney } from '@/utils/formatCompactMoney'
import type { DashboardMoneyFormat } from '@/dashboard/types/dashboard'

/**
 * Formats dashboard money values with widget-specific K/M compaction rules.
 * Input values are API minor units; thresholds are evaluated in major units.
 */
export function formatDashboardMoney(
  minorUnits: number,
  currency: string,
  format: DashboardMoneyFormat,
) {
  if (format === 'raw') return formatCurrency(minorUnits, currency)

  return formatCompactMoney(minorUnits, currency, DASHBOARD_MONEY_RULES[format])
}
