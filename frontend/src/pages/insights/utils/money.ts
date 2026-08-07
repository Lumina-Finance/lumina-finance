import type { Currency } from '@/api/currency'
import { formatCurrency } from '@/utils/formatCurrency'

/**
 * Returns the share of income left after expenses, as a whole percentage, or null when there was
 * no income in the period and the rate would have no meaning
 *
 * Spending more than was earned gives a negative result rather than being clamped at zero, so an
 * overspent period stays visible instead of looking like a break-even one
 */
export function getSavingsRate(income: number, expenses: number) {
  if (income <= 0) return null
  return Math.round(((income - expenses) / income) * 100)
}

/**
 * Renders a savings rate for display, showing "N/A" when there was no income to measure against
 * and an infinity symbol when spending happened with no income behind it
 */
export function formatSavingsRateValue(rate: number | null) {
  if (rate === null) return 'N/A'
  if (!Number.isFinite(rate)) return rate < 0 ? '−∞%' : '∞%'
  return `${rate}%`
}

/**
 * Formats an amount with a leading plus or minus so a movement reads as a direction, while zero
 * is shown plainly with no sign at all
 */
export function formatSignedCurrency(amount: number, currency: string, currencies: Currency[]) {
  if (amount === 0) return formatCurrency(amount, currency, currencies)
  return `${amount > 0 ? '+' : '-'}${formatCurrency(Math.abs(amount), currency, currencies)}`
}

/**
 * Returns the semantic colour token for a signed insight amount
 */
export function getSignedAmountColor(amount: number) {
  if (amount > 0) return 'var(--app-positive)'
  if (amount < 0) return 'var(--app-negative)'
  return 'var(--app-text)'
}
