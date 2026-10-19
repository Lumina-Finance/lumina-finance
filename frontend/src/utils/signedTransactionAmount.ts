export type AmountSign = -1 | 0 | 1

/**
 * Puts a transaction amount's sign in front of its already formatted magnitude
 *
 * A zero amount moved nothing, so it stays unsigned, the same as every other zero in the app
 */
export function signTransactionAmount(sign: AmountSign, magnitude: string) {
  if (sign === 0) return magnitude
  return `${sign < 0 ? '-' : '+'}${magnitude}`
}
