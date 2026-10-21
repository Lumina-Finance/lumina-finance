import { formatRatePercent } from '@/utils/negativeAmount'

/**
 * Renders a savings rate for display, showing "N/A" when there was no income to measure against
 * and an infinity symbol when spending happened with no income behind it
 */
export function formatSavingsRateValue(rate: number | null) {
  if (rate === null) return 'N/A'
  return formatRatePercent(rate)
}

/**
 * Returns the semantic colour token for a signed insight amount
 */
export function getSignedAmountColor(amount: number) {
  if (amount > 0) return 'var(--app-positive)'
  if (amount < 0) return 'var(--app-negative)'
  return 'var(--app-text)'
}
