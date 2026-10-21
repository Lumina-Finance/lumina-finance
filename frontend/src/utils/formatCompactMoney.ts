import type { Currency } from '@/api/currency'
import { formatCurrency, formatMajorUnits, formatMoneyParts, toMajorUnits } from '@/utils/formatCurrency'

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

// The magnitude a rule shows, already rounded, so the check for crossing into the next rule and the
// text itself read the same number
function getCompactMagnitude(value: number, rule: CompactMoneyRule) {
  const scaled = Math.abs(value) / rule.divisor
  if (rule.rounding !== 'ceil') return roundToDigits(scaled, rule.fractionDigits)

  const multiplier = 10 ** rule.fractionDigits
  return Math.ceil(scaled * multiplier) / multiplier
}

function applyCompactRule(value: number, rule: CompactMoneyRule) {
  const magnitude = getCompactMagnitude(value, rule)
  return value < 0 ? -magnitude : magnitude
}

// Moves an amount up to a larger rule when rounding it inside its own rule would reach that rule's
// threshold, so 999,500 reads "1M" rather than "1,000K". A larger rule is the one before it in the list
function promoteRoundedUp(value: number, rules: CompactMoneyRule[], index: number) {
  let promoted = index
  while (promoted > 0) {
    const rule = rules[promoted]
    const larger = rules[promoted - 1]
    if (getCompactMagnitude(value, rule) * rule.divisor < larger.threshold) break
    promoted -= 1
  }
  return promoted
}

/**
 * Formats an amount in a currency's minor units as compact text once it crosses one of the given
 * thresholds, such as showing "≈$1.2M" instead of the full number, and in full when no rule applies
 *
 * Rules are checked in order and the first whose threshold the absolute value meets is used, so callers
 * should list rules from largest threshold to smallest
 *
 * An amount that rounds up to a larger rule's threshold inside its own rule is shown by that larger
 * rule, so 999,500 reads "≈1M" rather than "≈1,000K". With `plainFractionDigits`, an amount that
 * rounds up to the smallest threshold at those decimals is shown by the smallest rule in the same way
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
  const found = rules.findIndex(({ threshold }) => Math.abs(majorUnits) >= threshold)
  const smallest = rules.length - 1
  // An amount shown whole that rounds up to the smallest threshold reads as that rule, not as a full
  // amount beside it
  const roundsToSmallest = found === -1 && smallest >= 0 && plainFractionDigits !== undefined
    && roundToDigits(Math.abs(majorUnits), plainFractionDigits) >= rules[smallest].threshold
  const start = roundsToSmallest ? smallest : found
  if (start === -1) {
    if (plainFractionDigits === undefined) return formatCurrency(minorUnits, currency, currencies)
    return formatMajorUnits(majorUnits, currency, plainFractionDigits)
  }

  const rule = rules[promoteRoundedUp(majorUnits, rules, start)]

  return `${prefix}${formatCurrencyWithSuffix(
    applyCompactRule(majorUnits, rule),
    currency,
    rule.suffix,
    rule.fractionDigits,
  )}`
}
