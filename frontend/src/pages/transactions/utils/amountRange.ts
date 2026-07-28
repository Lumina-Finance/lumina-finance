import { toMinorUnits } from '@/utils/moneyInput'

/**
 * Reports whether the amount filter's bounds exclude each other, which no transaction can satisfy
 *
 * Both bounds are converted to the stored minor units first, so the values compared are the ones
 * the list endpoint would receive rather than the typed text. A bound left blank, or holding text
 * naming no amount, cannot cross the other
 *
 * @param amount - The minimum and maximum as the fields hold them
 * @param exponent - Decimal places of the currency the range matches in
 */
export function isAmountRangeCrossed(amount: { min: string; max: string }, exponent: number): boolean {
  const min = toMinorUnits(amount.min, exponent)
  const max = toMinorUnits(amount.max, exponent)

  return min !== null && max !== null && min > max
}
