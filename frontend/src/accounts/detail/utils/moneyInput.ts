import type { Currency } from '@/api/currency'

function currencyExponent(currencies: Currency[], code: string): number {
  return currencies.find((currency) => currency.id === code)?.minor_unit_exponent ?? 2
}

export function fromMinorUnits(value: number | null, currencies: Currency[], code: string): string {
  if (value === null) return ''
  const exponent = currencyExponent(currencies, code)
  const major = value / Math.pow(10, exponent)
  return exponent === 0 ? String(Math.round(major)) : Number(major.toFixed(exponent)).toString()
}

export function toMinorUnits(value: string, currencies: Currency[], code: string): number | null {
  if (!value.trim()) return null
  const exponent = currencyExponent(currencies, code)
  return Math.round(Number(value) * Math.pow(10, exponent))
}

export function isValidMoneyInput(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0
}

