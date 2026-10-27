import type { Currency } from '@/api/currency'
import { formatCompactMoney, type CompactMoneyRule } from '@/utils/formatCompactMoney'
import { getShownAmountSign, signMovedAmount } from '@/utils/negativeAmount'

// A total too wide for its place at the smallest type size is written in millions to one decimal
// place, as every amount written in K or M is
const COMPACT_MOVED_MONEY_RULES: CompactMoneyRule[] = [
  { threshold: 1_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 1 },
]

/**
 * Formats an amount that moved in the short form shown when its full written form does not fit,
 * signed like `formatMovedCurrency`. A gain rounds down and a loss rounds up
 *
 * @param currencies - The fetched currency list, which carries each code's decimal places
 */
export function formatCompactMovedCurrency(minorUnits: number, currency: string, currencies: Currency[]): string {
  const magnitude = Math.abs(Math.round(minorUnits))
  const compact = formatCompactMoney(magnitude, currency, COMPACT_MOVED_MONEY_RULES, currencies, minorUnits < 0 ? 'up' : 'down')
  return signMovedAmount(getShownAmountSign(minorUnits), compact)
}

/**
 * Formats a held-style income or expenses total in the same short form, unsigned. An expense rounds
 * up and an income down
 */
export function formatCompactTotalCurrency(
  minorUnits: number,
  currency: string,
  currencies: Currency[],
  kind: 'income' | 'expense',
): string {
  return formatCompactMoney(
    Math.abs(Math.round(minorUnits)),
    currency,
    COMPACT_MOVED_MONEY_RULES,
    currencies,
    kind === 'expense' ? 'up' : 'down',
  )
}
