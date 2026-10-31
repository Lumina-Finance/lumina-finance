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

/** The neutral colour of a change figure that sits beside a flat icon or a label, a step quieter than text */
export const MUTED_ZERO_COLOR = 'var(--app-text-muted)'

/**
 * Returns the text colour for an amount's direction, with zero in the neutral text colour, or in
 * `zeroColor` where a change figure keeps a quieter neutral. Every amount that is coloured by its
 * direction reads this, so no screen colours a zero as a gain
 */
export function getAmountSignColor(sign: AmountSign, zeroColor = AMOUNT_SIGN_COLORS[0]): string {
  return sign === 0 ? zeroColor : AMOUNT_SIGN_COLORS[sign]
}

/**
 * Returns the text colour for an amount in minor units, read in the direction it is shown in, so an
 * amount that shows as zero is neutral just as its text is unsigned
 */
export function getSignedAmountColor(amount: number, zeroColor?: string): string {
  return getAmountSignColor(getShownAmountSign(amount), zeroColor)
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

// A savings rate with income near zero runs into the millions, which says nothing a reader can use
// and overflows the places it is shown, so a rate past this many percent is written as beyond it
const SAVINGS_RATE_DISPLAY_LIMIT = 999

/**
 * Formats a savings rate, which is unsigned when it is positive and written with the same negative
 * as an amount that moved when spending outran income. A rate beyond 999% either way is written as
 * "above 999%" or "below −999%". It takes a finite rate, since a month with no income has none
 */
export function formatRatePercent(rate: number): string {
  if (rate > SAVINGS_RATE_DISPLAY_LIMIT) return `above ${SAVINGS_RATE_DISPLAY_LIMIT}%`
  if (rate < -SAVINGS_RATE_DISPLAY_LIMIT) return `below ${signMovedAmount(-1, `${SAVINGS_RATE_DISPLAY_LIMIT}%`)}`
  const magnitude = Math.abs(rate).toString()
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
