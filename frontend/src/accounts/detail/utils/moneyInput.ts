import type { Currency } from '@/api/currency'

function currencyExponent(currencies: Currency[], code: string): number {
  return currencies.find((currency) => currency.id === code)?.minor_unit_exponent ?? 2
}

export function fromMinorUnits(value: number | null, currencies: Currency[], code: string): string {
  if (value === null) return ''
  const exponent = currencyExponent(currencies, code)
  const major = value / Math.pow(10, exponent)
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: exponent,
  }).format(exponent === 0 ? Math.round(major) : Number(major.toFixed(exponent)))
}

export function sanitizeMoneyInput(value: string): string {
  let sanitized = value.replace(/[^\d.]/g, '')
  const parts = sanitized.split('.')
  if (parts.length > 1) sanitized = `${parts[0]}.${parts.slice(1).join('')}`
  if (sanitized.startsWith('.')) sanitized = `0${sanitized}`
  return sanitized
}

export function formatMoneyInputLive(value: string): string {
  if (!value.trim()) return value
  const [integerPart, decimalPart] = value.split('.', 2)
  const formattedInteger = integerPart
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(integerPart))
    : '0'
  return value.includes('.') ? `${formattedInteger}.${decimalPart ?? ''}` : formattedInteger
}

export function toMinorUnits(value: string, currencies: Currency[], code: string): number | null {
  const normalized = value.replace(/,/g, '')
  if (!normalized.trim()) return null
  const exponent = currencyExponent(currencies, code)
  return Math.round(Number(normalized) * Math.pow(10, exponent))
}

export function isValidMoneyInput(value: string): boolean {
  const trimmed = value.replace(/,/g, '').trim()
  if (!trimmed) return true
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0
}
