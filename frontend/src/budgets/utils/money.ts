
import type { Currency } from '@/api/currency'

export function currencyExponent(currencies: Currency[], code: string) {
  return currencies.find((currency) => currency.id === code)?.minor_unit_exponent ?? 2
}

export function currencySymbol(currencies: Currency[], code: string) {
  return currencies.find((currency) => currency.id === code)?.symbol ?? ''
}

export function sanitizeMoneyInput(value: string) {
  let sanitized = value.replace(/[^\d.]/g, '')
  const parts = sanitized.split('.')
  if (parts.length > 1) sanitized = `${parts[0]}.${parts.slice(1).join('')}`
  if (sanitized.startsWith('.')) sanitized = `0${sanitized}`
  return sanitized
}

export function formatMoneyInputLive(value: string) {
  if (!value.trim()) return value
  const [integerPart, decimalPart] = value.split('.', 2)
  const formattedInteger = integerPart
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(integerPart))
    : '0'
  return value.includes('.') ? `${formattedInteger}.${decimalPart ?? ''}` : formattedInteger
}

export function toMinorUnits(value: string, currencies: Currency[], code: string) {
  if (!value.trim()) return null
  const numberValue = Number(value.replace(/,/g, ''))
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null
  return Math.round(numberValue * Math.pow(10, currencyExponent(currencies, code)))
}

export function formatMinorUnitsInput(value: number, currencies: Currency[], code: string) {
  const exponent = currencyExponent(currencies, code)
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: exponent,
  }).format(value / Math.pow(10, exponent))
}
