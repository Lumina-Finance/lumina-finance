/**
 * Writes an integer Actual stored at one scale as the unsigned decimal text a currency with another
 * number of decimal places holds, or null when it can't be held exactly, such as ¥12.34
 *
 * @param value - The stored integer, whose sign is dropped
 * @param fromDecimals - Decimal places the integer is stored in
 * @param toExponent - Decimal places the currency holds
 */
export function formatScaledAmount(value: number, fromDecimals: number, toExponent: number): string | null {
  const magnitude = BigInt(Math.abs(value))
  let units: bigint
  if (toExponent >= fromDecimals) {
    units = magnitude * 10n ** BigInt(toExponent - fromDecimals)
  } else {
    const divisor = 10n ** BigInt(fromDecimals - toExponent)
    if (magnitude % divisor !== 0n) return null
    units = magnitude / divisor
  }

  const digits = units.toString().padStart(toExponent + 1, '0')
  return toExponent === 0 ? digits : `${digits.slice(0, -toExponent)}.${digits.slice(-toExponent)}`
}
