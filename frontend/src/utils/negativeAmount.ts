import { getNegativeStyle, type MoneyKind, type NegativeStyle } from '@/utils/negativeStyle'

/** The direction of an amount, with zero as its own direction */
export type AmountSign = -1 | 0 | 1

const NEGATIVE_AFFIXES: Record<NegativeStyle, { prefix: string; suffix: string }> = {
  minus: { prefix: '−', suffix: '' },
  brackets: { prefix: '(', suffix: ')' },
}

/**
 * Returns the text that goes before and after a negative amount of this kind, which is the only
 * place a negative is written in either style
 */
export function getNegativeAffixes(kind: MoneyKind) {
  return NEGATIVE_AFFIXES[getNegativeStyle(kind)]
}

/**
 * Returns the direction of an amount, reading both 0 and -0 as zero
 */
export function getAmountSign(amount: number | bigint): AmountSign {
  if (amount < 0) return -1
  if (amount > 0) return 1
  return 0
}

/**
 * Puts an amount's direction in front of its already formatted magnitude
 *
 * Money in always carries a plus. Money out is written in the style set for amounts that moved. A
 * zero amount moved nothing, so it stays unsigned, the same as every other zero in the app
 */
export function signMovedAmount(sign: AmountSign, magnitude: string): string {
  if (sign === 0) return magnitude
  if (sign > 0) return `+${magnitude}`
  const { prefix, suffix } = getNegativeAffixes('moved')
  return `${prefix}${magnitude}${suffix}`
}

/**
 * Formats a percentage change that describes an amount that moved, signed the same way as the
 * amount, so a line never mixes a hyphen with a true minus. The sign follows the figure as shown, so
 * a change that rounds to zero is left unsigned
 *
 * @param fractionDigits - Decimal places to show, or the figure as it comes when left out
 */
export function formatMovedPercent(percent: number, fractionDigits?: number): string {
  const shown = fractionDigits === undefined ? Math.abs(percent).toString() : Math.abs(percent).toFixed(fractionDigits)
  const sign = Number(shown) === 0 ? 0 : getAmountSign(percent)
  return signMovedAmount(sign, `${shown}%`)
}
