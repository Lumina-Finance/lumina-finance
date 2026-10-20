/**
 * How a negative amount is written
 *
 * - `minus` puts a true minus (U+2212) in front of the whole amount, in every language
 * - `brackets` wraps the amount in parentheses
 */
export type NegativeStyle = 'minus' | 'brackets'

/**
 * The two kinds of money display. A held amount is a standing figure (a balance, net worth, credit
 * used, a limit). An amount that moved is a flow or a change (a transaction, a net flow, a change in
 * a balance, the adjustment an action will record)
 */
export type MoneyKind = 'held' | 'moved'

/** The direction of an amount, with zero as its own direction */
export type AmountSign = -1 | 0 | 1

export const TRUE_MINUS = '−'

// The product rules: a held amount shows a negative in brackets, and an amount that moved shows a
// true minus. This is the one place that decides, so a later user setting replaces what
// `getNegativeStyle` returns rather than being threaded through every screen
const DEFAULT_NEGATIVE_STYLES: Record<MoneyKind, NegativeStyle> = {
  held: 'brackets',
  moved: 'minus',
}

/**
 * Returns the style a negative amount of this kind is written in
 */
export function getNegativeStyle(kind: MoneyKind): NegativeStyle {
  return DEFAULT_NEGATIVE_STYLES[kind]
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
 * Money in always carries a plus. Money out is written in the given negative style. A zero amount
 * moved nothing, so it stays unsigned, the same as every other zero in the app
 */
export function signMovedAmount(
  sign: AmountSign,
  magnitude: string,
  style: NegativeStyle = getNegativeStyle('moved'),
): string {
  if (sign === 0) return magnitude
  if (sign > 0) return `+${magnitude}`
  return style === 'brackets' ? `(${magnitude})` : `${TRUE_MINUS}${magnitude}`
}
