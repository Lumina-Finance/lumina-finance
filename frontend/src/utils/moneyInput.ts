import type { Currency } from '@/api/currency'

// An editable amount is always written this way, whatever convention read-only amounts are
// displayed in, so the field shows exactly the value the form holds and the API receives
const CANONICAL_DECIMAL = '.'

// Currencies missing from the table are treated as having two decimal places
export const DEFAULT_MINOR_UNIT_EXPONENT = 2

// Whole digits, then at most one decimal point and its digits. Latin digits only, since a
// character the field cannot read is a character it will not take
const MONEY_INPUT = /^(\d*)(?:\.(\d*))?$/

function digitsOf(text: string): string {
  return text.replace(/\D/g, '')
}

/**
 * Splits a money value into its whole and decimal digits, reporting whether it carries a decimal
 * point at all so a half-typed amount keeps the point the user has already entered
 */
function splitMoneyInput(value: string): { whole: string; fraction: string; hasFraction: boolean } {
  const markAt = value.indexOf(CANONICAL_DECIMAL)
  if (markAt === -1) return { whole: value, fraction: '', hasFraction: false }

  return { whole: value.slice(0, markAt), fraction: value.slice(markAt + 1), hasFraction: true }
}

/**
 * Reports whether text is something a money field will take
 *
 * Nothing is repaired or reinterpreted. Text carrying grouping separators, a second decimal point,
 * digits in another script, or more decimals than the currency holds is simply not a money amount,
 * and the field keeps what it had rather than guessing which part of it was meant
 *
 * @param typed - The text the field would end up holding
 * @param exponent - Decimal places of the field's currency
 */
export function isAcceptedMoneyInput(typed: string, exponent: number): boolean {
  const match = MONEY_INPUT.exec(typed)
  if (!match) return false

  const fraction = match[2]
  if (fraction === undefined) return true

  return exponent > 0 && fraction.length <= exponent
}

/**
 * Returns the value a change to the field's text produces, which is the text itself when the field
 * will take it and the value it already held when it will not
 */
export function readMoneyInputChange(value: string, typed: string, exponent: number): string {
  return isAcceptedMoneyInput(typed, exponent) ? typed : value
}

/**
 * Returns the number of decimal places a currency uses, falling back to two when the code is not
 * in the table
 *
 * The fallback cannot tell an unrecognized code from a table that has not loaded yet, so a field
 * holding a stored amount should read its exponent through findCurrencyExponent below and lock when
 * there is none, rather than displaying an amount scaled by this guess
 */
export function getCurrencyExponent(currencies: Currency[], code: string): number {
  return currencies.find((currency) => currency.id === code)?.minor_unit_exponent ?? DEFAULT_MINOR_UNIT_EXPONENT
}

/**
 * Returns the number of decimal places a currency uses, or null when the code is not in the table
 *
 * A form holding a stored amount needs the difference the fallback above hides: without the real
 * exponent it can neither show that amount nor convert an edit to it, so the field has to lock
 * rather than display a number scaled by a guess
 */
export function findCurrencyExponent(currencies: Currency[], code: string): number | null {
  return currencies.find((currency) => currency.id === code)?.minor_unit_exponent ?? null
}

/**
 * Converts a money value into the whole minor units the API stores, returning null when it is
 * blank or names no number
 *
 * The decimal point is moved through the digits rather than the value being multiplied, so an
 * amount binary floating point cannot hold exactly still converts to the digits the user typed,
 * up to the largest integer JavaScript represents exactly
 *
 * Sign and zero policies stay with the caller, since a starting balance, a credit limit and a
 * budget limit each allow a different range
 */
export function toMinorUnits(value: string, exponent: number): number | null {
  if (!digitsOf(value) || !isValidMoneyInput(value)) return null

  const { whole, fraction } = splitMoneyInput(value)
  const kept = fraction.padEnd(exponent, '0').slice(0, exponent)
  const scaled = Number(`${whole || '0'}${kept}`)
  // A fraction longer than the currency holds only arrives when the currency changed under an
  // amount already entered, since the field refuses to take one while typing
  const firstDropped = fraction[exponent]

  return firstDropped !== undefined && Number(firstDropped) >= 5 ? scaled + 1 : scaled
}

/**
 * Converts stored minor units into a money value carrying the currency's decimal places, returning
 * an empty string for a null amount so an optional field stays empty
 */
export function fromMinorUnits(minorUnits: number | null, exponent: number): string {
  if (minorUnits === null) return ''

  return (minorUnits / Math.pow(10, exponent)).toFixed(exponent)
}

/**
 * Returns the zero a money field shows as its placeholder, carrying the currency's decimal places
 * so the field demonstrates a form it will actually take
 */
export function getMoneyPlaceholder(exponent: number): string {
  return fromMinorUnits(0, exponent)
}

/**
 * Settles a money value to the currency's decimal places, so the amount left on screen once the
 * field loses focus is the amount that will be stored
 */
export function normalizeMoneyInput(value: string, exponent: number): string {
  const minorUnits = toMinorUnits(value, exponent)

  return minorUnits === null ? '' : fromMinorUnits(minorUnits, exponent)
}

/**
 * Reports whether a money value is blank or names a number that is not negative
 */
export function isValidMoneyInput(value: string): boolean {
  if (!value.trim()) return true

  const amount = Number(value)

  return Number.isFinite(amount) && amount >= 0
}
