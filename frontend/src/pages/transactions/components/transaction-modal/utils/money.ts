import { fromMinorUnits, toMinorUnits } from '@/utils/moneyInput'
import type { TransactionDirection } from '@/pages/transactions/components/transaction-modal/types'

/**
 * Converts a stored signed minor-unit amount into a positive canonical input value
 */
export function amountToInputString(amountMinor: number, exponent: number): string {
  return fromMinorUnits(Math.abs(amountMinor), exponent)
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
