import { formatCurrency } from '@/utils/formatCurrency'

export type CompactMoneyRule = {
  threshold: number
  divisor: number
  suffix: 'K' | 'M'
  fractionDigits: number
  rounding?: 'ceil'
}

type CompactMoneyOptions = {
  prefix?: string
}

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
  const suffixIndex = parts.findLastIndex((part) => numberPartTypes.has(part.type))

  return parts
    .map((part, index) => `${part.value}${index === suffixIndex ? suffix : ''}`)
    .join('')
}

function applyCompactRule(value: number, rule: CompactMoneyRule) {
  const scaled = Math.abs(value) / rule.divisor
  const signed = value < 0 ? -1 : 1
  if (rule.rounding !== 'ceil') return value / rule.divisor

  const multiplier = 10 ** rule.fractionDigits
  return signed * (Math.ceil(scaled * multiplier) / multiplier)
}

/**
 * Formats an amount in a currency's minor units as compact text once it crosses one of the given
 * thresholds, such as showing "≈$1.2M" instead of the full number, falling back to `formatCurrency`
 * when no rule applies
 *
 * Rules are checked in order and the first whose threshold the absolute value meets is used, so callers
 * should list rules from largest threshold to smallest
 */
export function formatCompactMoney(
  minorUnits: number,
  currency: string,
  rules: CompactMoneyRule[],
  { prefix = '≈' }: CompactMoneyOptions = {},
) {
  const exponent = getCurrencyExponent(currency)
  const majorUnits = minorUnits / Math.pow(10, exponent) || 0
  const rule = rules.find(({ threshold }) => Math.abs(majorUnits) >= threshold)
  if (!rule) return formatCurrency(minorUnits, currency)

  return `${prefix}${formatCurrencyWithSuffix(
    applyCompactRule(majorUnits, rule),
    currency,
    rule.suffix,
    rule.fractionDigits,
  )}`
}
