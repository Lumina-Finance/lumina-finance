import { formatCurrency } from '@/utils/formatCurrency'
import { DASHBOARD_MONEY_RULES } from '@/dashboard/constants/moneyRules'
import type {
  CompactMoneyRule,
  DashboardMoneyFormat,
} from '@/dashboard/types/dashboard'

function getCurrencyExponent(currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency })
    .resolvedOptions()
    .maximumFractionDigits ?? 2
}

function formatCurrencyWithSuffix(
  value: number,
  currency: string,
  suffix: CompactMoneyRule['suffix'],
  fractionDigits: number,
) {
  const formatter = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    currencySign: 'accounting',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
  const parts = formatter.formatToParts(value)
  const numberPartTypes = new Set(['integer', 'group', 'decimal', 'fraction'])
  // Add K/M after the numeric portion while preserving locale currency
  // placement, signs, grouping, and accounting parentheses.
  const suffixIndex = parts.findLastIndex((part) => numberPartTypes.has(part.type))

  return parts
    .map((part, index) => `${part.value}${index === suffixIndex ? suffix : ''}`)
    .join('')
}

function applyCompactRule(value: number, rule: CompactMoneyRule) {
  const scaled = Math.abs(value) / rule.divisor
  const signed = value < 0 ? -1 : 1
  if (rule.rounding !== 'ceil') return value / rule.divisor

  // Some compact card values round up so small overages do not visually
  // understate the displayed dashboard total.
  const multiplier = 10 ** rule.fractionDigits
  return signed * (Math.ceil(scaled * multiplier) / multiplier)
}

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

  // API values are minor units; thresholds are expressed in major units because
  // compact display rules are meant to match what the user reads on screen.
  const exponent = getCurrencyExponent(currency)
  const majorUnits = minorUnits / Math.pow(10, exponent) || 0
  const rule = DASHBOARD_MONEY_RULES[format].find(({ threshold }) => Math.abs(majorUnits) >= threshold)
  if (!rule) return formatCurrency(minorUnits, currency)

  return `≈${formatCurrencyWithSuffix(
    applyCompactRule(majorUnits, rule),
    currency,
    rule.suffix,
    rule.fractionDigits,
  )}`
}
