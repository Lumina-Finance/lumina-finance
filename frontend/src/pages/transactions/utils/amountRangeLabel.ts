import type { AmountDraft } from '@/pages/transactions/utils/amountRange'
import { formatMajorUnits } from '@/utils/formatCurrency'

/**
 * Renders a filter bound for the summary chip, which is read-only text and so follows the reader's
 * own number convention rather than the plain format the amount fields hold
 */
function formatFilterAmount(value: string): string {
  if (!value.trim()) return ''

  // The bound already carries the decimals its currency uses, so the chip keeps exactly those
  // rather than letting the formatter trim a trailing zero
  const decimals = value.split('.')[1]?.length ?? 0

  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(value))
}

/** Builds the compact amount-range label shown in an active-filter chip */
export function buildAmountRangeLabel({
  amount,
  amountCurrency,
  amountExponent,
}: {
  amount: AmountDraft
  amountCurrency: string
  amountExponent: number
}): string | null {
  if (!amount.min && !amount.max) return null

  const lower = formatMajorUnits(Number(amount.min || '0'), amountCurrency, amountExponent)

  return `${lower}–${formatFilterAmount(amount.max) || 'any'}`
}
