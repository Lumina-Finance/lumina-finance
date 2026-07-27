import { DATE_FORMATS, formatDate } from '@/utils/date'

/**
 * Rewrites a date from an imported file into a year-month-day string, returning an empty string when
 * the value is not a date the import can read
 *
 * A two-part numeric date is read as month first and only falls back to day first when that reading
 * is not a real calendar day, and a two-digit year of 70 or above is treated as the twentieth century
 */
export function normalizeImportDate(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''

  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (isoMatch) {
    const year = Number(isoMatch[1])
    const month = Number(isoMatch[2])
    const day = Number(isoMatch[3])
    return isValidDateParts(year, month, day) ? formatYmd(year, month, day) : ''
  }

  const slashMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/)
  if (slashMatch) {
    const first = Number(slashMatch[1])
    const second = Number(slashMatch[2])
    const year = normalizeDateYear(Number(slashMatch[3]))
    if (isValidDateParts(year, first, second)) return formatYmd(year, first, second)
    if (isValidDateParts(year, second, first)) return formatYmd(year, second, first)
    return ''
  }

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return ''
  return formatYmd(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate())
}

/**
 * Turns a year-month-day string into the long date heading shown over a group of preview rows,
 * falling back to a missing-date label when no date could be read from the file
 *
 * The parts are handed to the date constructor separately rather than parsed from the string, so the
 * heading shows the day the file stated instead of shifting by one in western time zones
 */
export function getPreviewDateLabel(ymd: string) {
  if (!ymd) return 'Missing Date'
  const [year, month, day] = ymd.split('-').map(Number)
  return formatDate(new Date(year, month - 1, day), DATE_FORMATS.longDate)
}

function formatYmd(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Converts an amount into the whole minor units the backend stores, using the number of decimal
 * places the currency itself uses so a zero-decimal currency is not scaled by a hundred
 */
export function toMinorUnits(value: number, currency: string) {
  return Math.round(value * 10 ** getCurrencyExponent(currency))
}

function getCurrencyExponent(currency: string) {
  try {
    const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency })
    return formatter.resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

/**
 * Reports whether a currency code can actually be formatted by the browser, which rules out
 * three-letter values that look like codes but name no currency
 */
export function isSupportedCurrency(currency: string) {
  if (!isValidCurrencyCode(currency)) return false

  try {
    new Intl.NumberFormat(undefined, { style: 'currency', currency })
    return true
  } catch {
    return false
  }
}

/**
 * Reports whether a cell holds a date the import can read, covering year-first dates, two-part
 * numeric dates in either day or month order, and written dates such as 5 January 2024
 *
 * A numeric date counts as valid when either reading of it lands on a real calendar day, and a value
 * with no letters in it that matched neither numeric shape is refused rather than handed to the
 * browser's own date parsing, which would accept things like a bare year
 */
export function isValidDateValue(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return false

  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (isoMatch) {
    return isValidDateParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))
  }

  const slashMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/)
  if (slashMatch) {
    const first = Number(slashMatch[1])
    const second = Number(slashMatch[2])
    const year = normalizeDateYear(Number(slashMatch[3]))
    return isValidDateParts(year, first, second) || isValidDateParts(year, second, first)
  }

  return /[a-z]/i.test(trimmed) && !Number.isNaN(Date.parse(trimmed))
}

function normalizeDateYear(year: number) {
  if (year >= 100) return year
  return year >= 70 ? 1900 + year : 2000 + year
}

function isValidDateParts(year: number, month: number, day: number) {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

/**
 * Reports whether a cell holds an amount the import can read, which is exactly what the number
 * parser accepts, so a value carrying a currency symbol counts as invalid
 */
export function isValidAmountValue(value: string) {
  return parseImportNumber(value) !== null
}

/**
 * Reads an amount from an imported cell, accepting an optional sign, commas grouping the thousands
 * and a decimal part, and returning null for anything else
 *
 * Currency symbols, spaces between digits and brackets around negatives are all refused rather than
 * cleaned up, because guessing at them risks importing an amount the file never stated
 */
export function parseImportNumber(value: string) {
  const normalized = value.trim()
  if (!normalized) return null

  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(normalized)) return null

  const parsed = Number(normalized.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Reports whether a value has the shape of a currency code, meaning exactly three letters in either
 * case, without checking that the code names a real currency
 */
export function isValidCurrencyCode(value: string) {
  return /^[A-Z]{3}$/i.test(value.trim())
}

/**
 * Shortens a cell value for display, keeping the first 25 characters and adding an ellipsis once the
 * value runs past 28 characters so table columns stay an even width
 */
export function truncateValue(value: string) {
  return value.length > 28 ? `${value.slice(0, 25)}...` : value
}
