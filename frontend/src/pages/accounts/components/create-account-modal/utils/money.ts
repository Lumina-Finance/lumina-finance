import { toMinorUnits } from '@/utils/moneyInput'

/**
 * Converts optional account money input into currency minor units, keeping this field's own
 * policies on top of the shared conversion: a blank value stays null and a negative amount is
 * rejected rather than stored signed
 */
export function optionalAccountMoneyInputToMinorUnits(value: string, exponent: number): number | null {
  if (!value) return null
  if (Number(value) < 0) return null

  return toMinorUnits(value, exponent)
}
