import type { TransactionDirection } from '@/transactions/components/TransactionModal/transactionModalTypes'

/**
 * Builds the date input value using the browser's local calendar day
 */
export function getTodayLocalDateInputValue(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Converts a stored signed minor-unit amount into a positive fixed-decimal input value
 */
export function amountToInputString(amountMinor: number, exponent: number): string {
  return (Math.abs(amountMinor) / Math.pow(10, exponent)).toFixed(exponent)
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
 * Converts a positive decimal input into currency minor units
 */
export function amountInputToMinorUnits(value: string, exponent: number): number | null {
  const numericValue = Number.parseFloat(value)
  if (!Number.isFinite(numericValue) || numericValue <= 0) return null
  return Math.round(numericValue * Math.pow(10, exponent))
}

/**
 * Applies the selected transaction direction to a positive minor-unit amount
 */
export function applyTransactionDirection(amountMinor: number, direction: TransactionDirection): number {
  return direction === 'credit' ? amountMinor : -amountMinor
}
