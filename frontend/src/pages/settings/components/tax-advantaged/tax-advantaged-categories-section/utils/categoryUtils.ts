import type { Currency } from '@/api/currency'
import type { TaxAdvantagedCategoryLimit, TaxTreatment } from '@/api/tax-advantaged-categories'
import { DEFAULT_NEW_LIMIT_YEAR, TAX_TREATMENT_OPTIONS } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/constants'

/**
 * Latest year not already used by an existing limit, counting backward from the default new
 * limit year so a duplicate year is never suggested
 */
export function nextAvailableLimitYear(limits: TaxAdvantagedCategoryLimit[]) {
  const existingYears = new Set(limits.map((limit) => limit.year))
  for (let year = DEFAULT_NEW_LIMIT_YEAR; year >= 1900; year -= 1) {
    if (!existingYears.has(year)) return year
  }
  return DEFAULT_NEW_LIMIT_YEAR
}

/**
 * Builds the currency dropdown options, labelling each with its code, name and symbol
 */
export function currencyOptions(currencies: Currency[]) {
  return currencies.map((c) => ({ value: c.id, label: `${c.id} — ${c.name} (${c.symbol})` }))
}

/**
 * Minor unit exponent for a currency code, falling back to 2 decimal places when the currency
 * is not found
 */
export function currencyExponent(currencies: Currency[], code: string) {
  return currencies.find((c) => c.id === code)?.minor_unit_exponent ?? 2
}

/**
 * Symbol for a currency code, falling back to an empty string when the currency is not found
 */
export function currencySymbol(currencies: Currency[], code: string) {
  return currencies.find((c) => c.id === code)?.symbol ?? ''
}

/**
 * Formats a raw money input string at the currency's decimal precision, leaving it untouched
 * while it is empty or not a valid number
 */
export function formatMoneyInput(value: string, currencies: Currency[], code: string) {
  if (!value.trim() || !isValidMoneyInput(value)) return value
  const exponent = currencyExponent(currencies, code)
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(Number(value))
}

/**
 * Checks whether a money input string is a valid non-negative number, treating an empty value
 * as valid unless the field is required
 */
export function isValidMoneyInput(value: string, required = false) {
  const trimmed = value.trim()
  if (!trimmed) return !required
  const n = Number(trimmed)
  return Number.isFinite(n) && n >= 0
}

/**
 * Converts a money input string into the currency's minor units, returning null for an empty
 * input
 */
export function toMinorUnits(value: string, currencies: Currency[], code: string) {
  if (!value.trim()) return null
  const multiplier = Math.pow(10, currencyExponent(currencies, code))
  return Math.round(Number(value) * multiplier)
}

/**
 * Converts an amount in minor units back into a display string at the currency's decimal
 * precision, returning an empty string for a null amount
 */
export function fromMinorUnits(value: number | null, currencies: Currency[], code: string) {
  if (value === null) return ''
  const exponent = currencyExponent(currencies, code)
  const major = value / Math.pow(10, exponent)
  return exponent === 0 ? String(Math.round(major)) : Number(major.toFixed(exponent)).toString()
}

/**
 * Label to show for a tax treatment, falling back to the raw value when it is not one of the
 * known options
 */
export function formatTaxTreatment(value: TaxTreatment) {
  return TAX_TREATMENT_OPTIONS.find((option) => option.value === value)?.label ?? value
}

/**
 * Current calendar year in the given timezone, falling back to the browser's local year when no
 * timezone is given or the timezone cannot be resolved
 */
export function currentYearForTimezone(timeZone?: string) {
  if (!timeZone) return new Date().getFullYear()

  try {
    return Number(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric' }).format(new Date()))
  } catch {
    return new Date().getFullYear()
  }
}

/**
 * Compact label summarizing a category's configured limit years, collapsing a contiguous run
 * into a range and a scattered few into a short list
 *
 * A long, non-contiguous set falls back to a plain count instead of listing every year, so the
 * label never grows unbounded
 */
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
