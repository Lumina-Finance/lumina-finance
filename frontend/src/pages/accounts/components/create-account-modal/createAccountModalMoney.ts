/**
 * Converts optional account money input into currency minor units while preserving empty optional fields
 */
export function optionalAccountMoneyInputToMinorUnits(value: string, exponent: number): number | null {
  if (!value) return null

  const numericValue = Number.parseFloat(value.replace(/,/g, ''))
  if (!Number.isFinite(numericValue) || numericValue < 0) return null

  return Math.round(numericValue * Math.pow(10, exponent))
}
