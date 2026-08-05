import { findCurrencyExponent, fromMinorUnits, toMinorUnits } from '@/utils/moneyInput'
import type { Currency } from '@/api/currency'
import type { TransactionDirection } from '@/pages/transactions/components/transaction-modal/types'

/**
 * Converts a stored signed minor-unit amount into a positive canonical input value
 */
export function amountToInputString(amountMinor: number, exponent: number): string {
  return fromMinorUnits(Math.abs(amountMinor), exponent)
}

/**
 * Converts a stored amount into input text through its own currency's decimal places, or returns
 * null when the currency is not in the table
 *
 * A stored amount can only be turned into text through the real decimal places, so a currency the
 * table does not carry yields nothing rather than a number scaled by the two-place fallback
 *
 * The text is unsigned, since the form carries which way the money went in its direction field
 *
 * @param amountMinor - The stored signed minor-unit amount
 * @param currencies - The currency table, which is empty until it downloads
 * @param code - The amount's own currency
 */
export function findAmountInputString(
  amountMinor: number,
  currencies: Currency[],
  code: string,
): string | null {
  const exponent = findCurrencyExponent(currencies, code)

  return exponent === null ? null : amountToInputString(amountMinor, exponent)
}

/**
 * Reads a typed sign from the money input so users can switch direction without leaving the field
 */
export function getDirectionFromAmountInputSign(value: string): TransactionDirection | null {
  let direction: TransactionDirection | null = null

  // The last sign wins so pasted text follows the final visible intent
  for (const char of value) {
    if (char === '+') direction = 'credit'
    if (char === '-') direction = 'debit'
  }

  return direction
}

/**
 * Converts a positive canonical input into currency minor units, keeping the transaction amount's
 * own "must be greater than zero" policy on top of the shared conversion
 */
export function amountInputToMinorUnits(value: string, exponent: number): number | null {
  const minorUnits = toMinorUnits(value, exponent)
  if (minorUnits === null || minorUnits <= 0) return null
  return minorUnits
}

/**
 * Applies the selected transaction direction to a positive minor-unit amount
 */
export function applyTransactionDirection(amountMinor: number, direction: TransactionDirection): number {
  return direction === 'credit' ? amountMinor : -amountMinor
}
