import { formatRatePercent } from '@/utils/negativeAmount'

/**
 * Renders a savings rate for display, showing "N/A" when there was no income to measure against
 */
export function formatSavingsRateValue(rate: number | null) {
  if (rate === null) return 'N/A'
  return formatRatePercent(rate)
}
