/**
 * Which way a shown figure rounds. `up` is for a figure where more is worse (an expense, a debt,
 * credit used, a budget's spent), `down` for one where less is worse (an income, an asset, a balance,
 * net worth, a savings rate), so a rounded figure never reads better than it is. Both act on the
 * signed number, so `down` takes -2.5 to -3 and `up` takes it to -2
 */
export type RoundingDirection = 'up' | 'down'

/**
 * Divides two integers and rounds the quotient up or down, working from the remainder so a quotient
 * that is exactly whole is never nudged by floating point, which dividing first can do
 */
export function divideRounded(numerator: number, denominator: number, direction: RoundingDirection): number {
  const remainder = ((numerator % denominator) + denominator) % denominator
  const floored = (numerator - remainder) / denominator
  return direction === 'up' && remainder !== 0 ? floored + 1 : floored
}

/**
 * Returns what share one amount is of another as a percentage, rounded in the given direction, from
 * whole minor units so an exact value such as 14.5% is never read as 14.499…% by a division. The
 * caller handles a whole of zero or less
 *
 * @param fractionDigits - Decimal places to round to, none by default
 */
export function getRoundedPercent(
  part: number,
  whole: number,
  direction: RoundingDirection,
  fractionDigits = 0,
): number {
  const scale = 10 ** fractionDigits
  return divideRounded(Math.round(part) * 100 * scale, Math.round(whole), direction) / scale
}
