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
 * Returns the direction of an amount in minor units as it is shown, which is rounded to whole minor
 * units, so an amount that shows as zero is zero. Colours and text both read this, so they agree
 */
export function getShownAmountSign(amount: number): AmountSign {
  return Math.round(Math.abs(amount)) === 0 ? 0 : getAmountSign(amount)
}

const AMOUNT_SIGN_COLORS: Record<AmountSign, string> = {
  [-1]: 'var(--app-negative)',
  0: 'var(--app-text)',
  1: 'var(--app-positive)',
}

/**
 * Returns the text colour for an amount's direction, with zero in the neutral text colour. Every
 * amount that is coloured by its direction reads this, so no screen colours a zero as a gain
 */
export function getAmountSignColor(sign: AmountSign): string {
  return AMOUNT_SIGN_COLORS[sign]
}

/**
 * Returns the text colour for an amount in minor units, read in the direction it is shown in, so an
 * amount that shows as zero is neutral just as its text is unsigned
 */
export function getSignedAmountColor(amount: number): string {
  return getAmountSignColor(getShownAmountSign(amount))
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
 * Formats a savings rate, which is unsigned when it is positive and written with the same negative
 * as an amount that moved when spending outran income. Minus infinity, the rate of spending with no
 * income behind it, is written the same way
 */
export function formatRatePercent(rate: number): string {
  const magnitude = Number.isFinite(rate) ? Math.abs(rate).toString() : '∞'
  return rate < 0 ? signMovedAmount(-1, `${magnitude}%`) : `${magnitude}%`
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
