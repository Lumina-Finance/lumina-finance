import type { Currency } from '@/api/currency'
import { createMoneyFormatter, formatCurrency, toMajorUnits } from '@/utils/formatCurrency'

export type CompactMoneyRule = {
  threshold: number
  divisor: number
  suffix: 'K' | 'M'
  fractionDigits: number
  rounding?: 'ceil'
}

type CompactMoneyOptions = {
  prefix?: string

  // Decimal places for an amount below every threshold, which renders in full rather than compacted.
  // Left unset it follows the currency's own, so a caller showing whole amounts when compacted has
  // to say so here or a small amount comes back carrying cents the rest of its scale does not show
  plainFractionDigits?: number
}

function formatCurrencyWithSuffix(
  value: number,
  currency: string,
  suffix: CompactMoneyRule['suffix'],
  fractionDigits: number,
) {
  const parts = createMoneyFormatter(currency, fractionDigits).formatToParts(value)
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
 * thresholds, such as showing "≈$1.2M" instead of the full number, and in full when no rule applies
 *
 * Rules are checked in order and the first whose threshold the absolute value meets is used, so callers
 * should list rules from largest threshold to smallest
 *
 * @param currencies - The fetched currency list, which carries each code's decimal places
 */
export function formatCompactMoney(
  minorUnits: number,
  currency: string,
  rules: CompactMoneyRule[],
  currencies: Currency[],
  { prefix = '≈', plainFractionDigits }: CompactMoneyOptions = {},
) {
  const majorUnits = toMajorUnits(minorUnits, currency, currencies)
  const rule = rules.find(({ threshold }) => Math.abs(majorUnits) >= threshold)
  if (!rule) {
    if (plainFractionDigits === undefined) return formatCurrency(minorUnits, currency, currencies)
    return createMoneyFormatter(currency, plainFractionDigits).format(majorUnits)
  }

  return `${prefix}${formatCurrencyWithSuffix(
    applyCompactRule(majorUnits, rule),
    currency,
    rule.suffix,
    rule.fractionDigits,
  )}`
}
