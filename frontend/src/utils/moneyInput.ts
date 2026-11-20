import type { Currency } from '@/api/currency'

// An editable amount is always written this way, whatever convention read-only amounts are
// displayed in, so the field shows exactly the value the form holds and the API receives
const CANONICAL_DECIMAL = '.'

// Currencies missing from the table are treated as having two decimal places
export const DEFAULT_MINOR_UNIT_EXPONENT = 2

// The bounds of the signed 64-bit column the backend stores an amount in. The negative side
// reaches one further than the positive, as two's complement does, so a caller that negates an
// amount has to bound its own result. The same two values are written out again in
// backend/app/utils/money.py, and the two have to agree
export const MIN_MINOR_UNITS = -(2n ** 63n)
export const MAX_MINOR_UNITS = 2n ** 63n - 1n

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
 * Reports whether text typed or pasted into a money field holds a hyphen or a true minus, so the text a
 * field that takes no negative amount refused can be read to say why
 */
export function holdsMinus(typed: string): boolean {
  return /[-−]/.test(typed)
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

  const { digits, roundsUp } = scaleToMinorUnitDigits(value, exponent)
  const scaled = Number(digits)

  return roundsUp ? scaled + 1 : scaled
}

/**
 * Reports whether a money value, counted in minor units, is past a ceiling
 *
 * The digits are compared as integers rather than as numbers, since the largest amount the API
 * stores is past what a number holds exactly, and a number of enough digits is no finite number at
 * all. Text a money field would not take, and text holding no digit, is never past the ceiling
 *
 * @param value - The money value as the field holds it
 * @param exponent - Decimal places of the field's currency
 * @param ceiling - The largest whole number of minor units that is allowed
 */
export function isMinorUnitsAbove(value: string, exponent: number, ceiling: bigint): boolean {
  if (!MONEY_INPUT.test(value) || !digitsOf(value)) return false

  const { digits, roundsUp } = scaleToMinorUnitDigits(value, exponent)

  return BigInt(digits) + (roundsUp ? 1n : 0n) > ceiling
}

/**
 * Moves a money value's decimal point through its digits to count it in minor units, and says
 * whether the digits dropped past the currency's places round the amount up
 */
function scaleToMinorUnitDigits(value: string, exponent: number): { digits: string; roundsUp: boolean } {
  const { whole, fraction } = splitMoneyInput(value)
  const kept = fraction.padEnd(exponent, '0').slice(0, exponent)
  // A fraction longer than the currency holds only arrives when the currency changed under an
  // amount already entered, since the field refuses to take one while typing
  const firstDropped = fraction[exponent]

  return { digits: `${whole || '0'}${kept}`, roundsUp: firstDropped !== undefined && Number(firstDropped) >= 5 }
}

/**
 * Converts stored whole minor units into a money value carrying the currency's decimal places,
 * returning an empty string for a null amount so an optional field stays empty
 *
 * The decimal point is moved through the digits rather than the value being divided, so every
 * integer up to the largest one JavaScript represents exactly shows as the digits stored
 */
export function fromMinorUnits(minorUnits: number | null, exponent: number): string {
  if (minorUnits === null) return ''

  const sign = minorUnits < 0 ? '-' : ''
  // One more digit than the decimal places, so an amount below one whole unit keeps its leading zero
  const digits = String(Math.abs(minorUnits)).padStart(exponent + 1, '0')
  if (exponent === 0) return `${sign}${digits}`

  const pointAt = digits.length - exponent

  return `${sign}${digits.slice(0, pointAt)}${CANONICAL_DECIMAL}${digits.slice(pointAt)}`
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
 * Settles a money value as the field loses focus. An amount past a ceiling is left as typed
 *
 * A number rounds an amount of that size, or writes it in a form the field cannot read, so settling
 * it would change what was typed and could hide the refusal the caller shows for it
 *
 * @param value - The money value as the field holds it
 * @param exponent - Decimal places of the field's currency
 * @param ceiling - The largest whole number of minor units to settle, or undefined to settle every value
 */
export function settleMoneyInput(value: string, exponent: number, ceiling?: bigint): string {
  return ceiling !== undefined && isMinorUnitsAbove(value, exponent, ceiling)
    ? value
    : normalizeMoneyInput(value, exponent)
}

/**
 * Reports whether a money value is blank or names a number that is not negative
 */
export function isValidMoneyInput(value: string): boolean {
  if (!value.trim()) return true

  const amount = Number(value)

  return Number.isFinite(amount) && amount >= 0
}
