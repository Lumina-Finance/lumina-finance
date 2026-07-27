import type { Currency } from '@/api/currency'

function currencyExponent(currencies: Currency[], code: string): number {
  return currencies.find((currency) => currency.id === code)?.minor_unit_exponent ?? 2
}

/**
 * Formats a stored minor-unit amount into a locale-formatted decimal string sized to the
 * currency's precision, returning an empty string for a null value
 */
export function fromMinorUnits(value: number | null, currencies: Currency[], code: string): string {
  if (value === null) return ''
  const exponent = currencyExponent(currencies, code)
  const major = value / Math.pow(10, exponent)
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: exponent,
  }).format(exponent === 0 ? Math.round(major) : Number(major.toFixed(exponent)))
}

/**
 * Converts a user-entered decimal amount string into the currency's minor units for storage,
 * returning null only when the input is blank
 */
export function toMinorUnits(value: string, currencies: Currency[], code: string): number | null {
  const normalized = value.replace(/,/g, '')
  if (!normalized.trim()) return null
  const exponent = currencyExponent(currencies, code)
  return Math.round(Number(normalized) * Math.pow(10, exponent))
}

/**
 * Checks whether a money input string is blank or a valid non-negative number, ignoring
 * thousands separators
 */
export function isValidMoneyInput(value: string): boolean {
  const trimmed = value.replace(/,/g, '').trim()
  if (!trimmed) return true
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0
}
