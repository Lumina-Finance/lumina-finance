import type { Currency } from '@/api/currency'
import type { TaxAdvantagedCategoryLimit, TaxTreatment } from '@/api/taxAdvantagedCategories'
import { DEFAULT_NEW_LIMIT_YEAR, TAX_TREATMENT_OPTIONS } from '@/settings/components/TaxAdvantaged/TaxAdvantagedCategoriesSection/taxAdvantagedCategoryConstants'

export function nextAvailableLimitYear(limits: TaxAdvantagedCategoryLimit[]) {
  const existingYears = new Set(limits.map((limit) => limit.year))
  for (let year = DEFAULT_NEW_LIMIT_YEAR; year >= 1900; year -= 1) {
    if (!existingYears.has(year)) return year
  }
  return DEFAULT_NEW_LIMIT_YEAR
}

export function currencyOptions(currencies: Currency[]) {
  return currencies.map((c) => ({ value: c.id, label: `${c.id} — ${c.name} (${c.symbol})` }))
}

export function currencyExponent(currencies: Currency[], code: string) {
  return currencies.find((c) => c.id === code)?.minor_unit_exponent ?? 2
}

export function currencySymbol(currencies: Currency[], code: string) {
  return currencies.find((c) => c.id === code)?.symbol ?? ''
}

export function formatMoneyInput(value: string, currencies: Currency[], code: string) {
  if (!value.trim() || !isValidMoneyInput(value)) return value
  const exponent = currencyExponent(currencies, code)
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(Number(value))
}

export function isValidMoneyInput(value: string, required = false) {
  const trimmed = value.trim()
  if (!trimmed) return !required
  const n = Number(trimmed)
  return Number.isFinite(n) && n >= 0
}

export function toMinorUnits(value: string, currencies: Currency[], code: string) {
  if (!value.trim()) return null
  const multiplier = Math.pow(10, currencyExponent(currencies, code))
  return Math.round(Number(value) * multiplier)
}

export function fromMinorUnits(value: number | null, currencies: Currency[], code: string) {
  if (value === null) return ''
  const exponent = currencyExponent(currencies, code)
  const major = value / Math.pow(10, exponent)
  return exponent === 0 ? String(Math.round(major)) : Number(major.toFixed(exponent)).toString()
}

export function formatTaxTreatment(value: TaxTreatment) {
  return TAX_TREATMENT_OPTIONS.find((option) => option.value === value)?.label ?? value
}

export function currentYearForTimezone(timeZone?: string) {
  if (!timeZone) return new Date().getFullYear()

  try {
    return Number(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric' }).format(new Date()))
  } catch {
    return new Date().getFullYear()
  }
}

export function formatLimitYears(years: number[]) {
  const uniqueYears = [...new Set(years)].sort((a, b) => a - b)
  if (uniqueYears.length === 0) return 'None'
  if (uniqueYears.length === 1) return `${uniqueYears[0]} only`

  const isContiguous = uniqueYears.every((year, index) => index === 0 || year === uniqueYears[index - 1] + 1)
  const span = isContiguous
    ? `${uniqueYears[0]}-${uniqueYears[uniqueYears.length - 1]}`
    : uniqueYears.length <= 3
      ? uniqueYears.join(', ')
      : `${uniqueYears.length} years configured`

  if (!isContiguous && uniqueYears.length > 3) return span
  return `${span} · ${uniqueYears.length} years`
}
