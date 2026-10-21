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

// The product rules: a held amount shows a negative in brackets, and an amount that moved shows a
// true minus. This is the one place that decides, so a later user setting replaces what
// `getNegativeStyle` returns and nothing else
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
