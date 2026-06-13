import type { Currency } from '@/api/currency'

export function currencyExponent(currencies: Currency[], code: string) {
  return currencies.find((currency) => currency.id === code)?.minor_unit_exponent ?? 2
}

export function currencySymbol(currencies: Currency[], code: string) {
  return currencies.find((currency) => currency.id === code)?.symbol ?? ''
}

/**
 * Converts a positive user-entered decimal amount into the currency's minor units
 */
export function toMinorUnits(value: string, currencies: Currency[], code: string) {
  if (!value.trim()) return null
  const numberValue = Number(value.replace(/,/g, ''))
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null
  return Math.round(numberValue * Math.pow(10, currencyExponent(currencies, code)))
}

/**
 * Formats a stored minor-unit value back into an editable decimal input
 */
export function formatMinorUnitsInput(value: number, currencies: Currency[], code: string) {
  const exponent = currencyExponent(currencies, code)
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: exponent,
  }).format(value / Math.pow(10, exponent))
}
