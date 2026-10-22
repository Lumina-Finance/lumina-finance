import type { Currency } from '@/api/currency'
import { formatMajorUnits, formatMoneyParts, resolveDisplayExponent, toMajorUnits } from '@/utils/formatCurrency'
import { divideRounded, type RoundingDirection } from '@/utils/rounding'

export type CompactMoneyRule = {
  threshold: number
  divisor: number
  suffix: 'K' | 'M'
  fractionDigits: number
}

/**
 * How a compact amount rounds: up or down by what the figure is (`utils/rounding.ts`), or to the
 * nearest for a chart axis tick, which is a round step chosen for the scale rather than a figure
 */
export type CompactMoneyRounding = RoundingDirection | 'nearest'

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
  const parts = formatMoneyParts(value, currency, fractionDigits)
  const numberPartTypes = new Set(['integer', 'group', 'decimal', 'fraction'])
  const suffixIndex = parts.findLastIndex((part) => numberPartTypes.has(part.type))

  return parts
    .map((part, index) => `${part.value}${index === suffixIndex ? suffix : ''}`)
    .join('')
}

// Rounds half away from zero on the decimal the amount reads as, the way the browser's own formatter
// does, so 1.005 at two places is 1.01 rather than the 1.00 its binary form would give. The 15 digits
// drop the noise a division leaves past what a double can hold
function roundToDigits(magnitude: number, fractionDigits: number) {
  const multiplier = 10 ** fractionDigits
  return Math.round(Number((magnitude * multiplier).toPrecision(15))) / multiplier
}

// The amount in units of the divisor, rounded to the decimal places given. Up and down divide the
// whole minor units, so an amount that lands exactly on a step is never moved by a floating-point
// quotient
function roundAmount(
  minorUnits: number,
  exponent: number,
  divisor: number,
  fractionDigits: number,
  rounding: CompactMoneyRounding,
) {
  if (rounding === 'nearest') {
    const magnitude = roundToDigits(Math.abs(minorUnits) / 10 ** exponent / divisor, fractionDigits)
    return minorUnits < 0 ? -magnitude : magnitude
  }

  const multiplier = 10 ** fractionDigits
  return divideRounded(minorUnits * multiplier, divisor * 10 ** exponent, rounding) / multiplier
}

// Moves an amount up to a larger rule when rounding it inside its own rule would reach that rule's
// threshold, so 999,500 rounded up reads "1M" rather than "1,000K". A larger rule is the one before
// it in the list
function promoteRounded(
  minorUnits: number,
  exponent: number,
  rules: CompactMoneyRule[],
  index: number,
  rounding: CompactMoneyRounding,
) {
  let promoted = index
  while (promoted > 0) {
    const rule = rules[promoted]
    const larger = rules[promoted - 1]
    const rounded = roundAmount(minorUnits, exponent, rule.divisor, rule.fractionDigits, rounding)
    if (Math.abs(rounded) * rule.divisor < larger.threshold) break
    promoted -= 1
  }
  return promoted
}

/**
 * Formats an amount in a currency's minor units whole or to a fixed number of decimal places,
 * rounded in the direction the figure calls for (`utils/rounding.ts`)
 */
function formatRoundedMoney(
  minorUnits: number,
  currency: string,
  currencies: Currency[],
  fractionDigits: number,
  rounding: CompactMoneyRounding,
) {
  const exponent = resolveDisplayExponent(currency, currencies)
  return formatMajorUnits(roundAmount(minorUnits, exponent, 1, fractionDigits, rounding), currency, fractionDigits)
}

/**
 * Formats an amount in a currency's minor units as compact text once it crosses one of the given
 * thresholds, such as showing "≈$1.2M" instead of the full number, and in full when no rule applies.
 * An amount below every threshold keeps its cents, unless the caller asks for fewer decimals
 *
 * Rules are checked in order and the first whose threshold the absolute value meets is used, so callers
 * should list rules from largest threshold to smallest
 *
 * The rounding is the caller's to choose for the figure shown, never a default: `up` for an expense,
 * debt, credit used or budget spent, `down` for an income, asset, balance or net worth, and `nearest`
 * only for a chart axis tick. An amount that rounds to a larger rule's threshold inside its own rule is
 * shown by that larger rule, so 999,500 rounded up reads "≈1M" rather than "≈1,000K". With
 * `plainFractionDigits`, an amount that rounds to the smallest threshold at those decimals is shown by
 * the smallest rule in the same way
 *
 * @param currencies - The fetched currency list, which carries each code's decimal places
 */
export function formatCompactMoney(
  minorUnits: number,
  currency: string,
  rules: CompactMoneyRule[],
  currencies: Currency[],
  rounding: CompactMoneyRounding,
  { prefix = '≈', plainFractionDigits }: CompactMoneyOptions = {},
) {
  const exponent = resolveDisplayExponent(currency, currencies)
  const majorUnits = toMajorUnits(minorUnits, currency, currencies)
  const found = rules.findIndex(({ threshold }) => Math.abs(majorUnits) >= threshold)
  const smallest = rules.length - 1
  // An amount shown whole that rounds to the smallest threshold reads as that rule, not as a full
  // amount beside it
  const roundsToSmallest = found === -1 && smallest >= 0 && plainFractionDigits !== undefined
    && Math.abs(roundAmount(minorUnits, exponent, 1, plainFractionDigits, rounding)) >= rules[smallest].threshold
  const start = roundsToSmallest ? smallest : found
  if (start === -1) {
    if (plainFractionDigits === undefined) return formatMajorUnits(majorUnits, currency, exponent)
    return formatRoundedMoney(minorUnits, currency, currencies, plainFractionDigits, rounding)
  }

  const rule = rules[promoteRounded(minorUnits, exponent, rules, start, rounding)]

  return `${prefix}${formatCurrencyWithSuffix(
    roundAmount(minorUnits, exponent, rule.divisor, rule.fractionDigits, rounding),
    currency,
    rule.suffix,
    rule.fractionDigits,
  )}`
}
