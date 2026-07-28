import { DATE_FORMATS, formatDate, parseYmd } from '@/utils/date'

/**
 * The shapes a date column can be read in. One is chosen for the whole import, because a file that
 * changes format part way through has no single reading that is right for all of its rows
 */
export const IMPORT_DATE_FORMATS = ['yearFirst', 'dayFirst', 'monthFirst', 'written'] as const

export type ImportDateFormat = (typeof IMPORT_DATE_FORMATS)[number]

/**
 * Which formats every value in a column reads under, and the value that ruled each of the rest out
 */
export interface ImportDateFormatScan {
  readable: ImportDateFormat[]
  rejectedBy: Partial<Record<ImportDateFormat, string>>
}

interface CalendarDateParts {
  year: number
  month: number
  day: number
}

// Four-digit year, then month and day. The backreference makes the second separator match the
// first, so a half-hyphenated value like 2024-03/15 is malformed rather than a format
const YEAR_FIRST_PATTERN = /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})$/

// Day first and month first share one shape and differ only in which part is read as the month. The
// year is four digits in both, since a two-digit year is a guess about the century
const NUMERIC_PATTERN = /^(\d{1,2})([-/])(\d{1,2})\2(\d{4})$/

// A written date carries the month name on either side of the day, with the comma and the
// abbreviation's trailing period both optional
const WRITTEN_MONTH_FIRST_PATTERN = /^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/i
const WRITTEN_DAY_FIRST_PATTERN = /^(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{4})$/i

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

// How many letters an accepted abbreviation has, so "sep" reads as September while "sept" does not
const MONTH_ABBREVIATION_LENGTH = 3

/**
 * Reads one cell as a calendar day in the given format
 *
 * @param value - The raw cell value
 * @param format - The format chosen for this import
 * @returns The zero-padded YYYY-MM-DD string the API takes, or an empty string when the value does
 * not read in that format or names a day the calendar does not have
 */
export function readImportDate(value: string, format: ImportDateFormat) {
  const parts = readCalendarDateParts(value.trim(), format)
  if (!parts) return ''

  const ymd = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`

  // Whether the parts name a day that exists is the shared parser's decision, so February 31 is
  // refused identically whichever of the four formats it was written in
  return parseYmd(ymd) ? ymd : ''
}

/**
 * Reports which formats a whole column reads under, so the mapping step can default to the only
 * survivor and name the value that ruled each of the others out
 *
 * @param values - Every cell in the column, blanks included
 */
export function scanImportDateFormats(values: string[]): ImportDateFormatScan {
  const filled = values.map((value) => value.trim()).filter(Boolean)
  const readable: ImportDateFormat[] = []
  const rejectedBy: Partial<Record<ImportDateFormat, string>> = {}

  for (const format of IMPORT_DATE_FORMATS) {
    const offender = filled.find((value) => !readImportDate(value, format))
    if (offender === undefined) readable.push(format)
    else rejectedBy[format] = offender
  }

  return { readable, rejectedBy }
}

/**
 * Turns a year-month-day string into the long date heading shown over a group of preview rows,
 * falling back to a missing-date label when no date could be read from the file
 */
export function getPreviewDateLabel(ymd: string) {
  const date = parseYmd(ymd)

  return date ? formatDate(date, DATE_FORMATS.longDate) : 'Missing Date'
}

/**
 * Splits a value into calendar parts under one format, without judging whether they name a real day
 */
function readCalendarDateParts(value: string, format: ImportDateFormat): CalendarDateParts | null {
  if (format === 'written') return readWrittenDateParts(value)

  if (format === 'yearFirst') {
    const match = YEAR_FIRST_PATTERN.exec(value)
    return match ? { year: Number(match[1]), month: Number(match[3]), day: Number(match[4]) } : null
  }

  const match = NUMERIC_PATTERN.exec(value)
  if (!match) return null

  const first = Number(match[1])
  const second = Number(match[3])
  const year = Number(match[4])

  return format === 'dayFirst'
    ? { year, month: second, day: first }
    : { year, month: first, day: second }
}

/**
 * Splits a written date, accepting the month name on either side of the day
 */
function readWrittenDateParts(value: string): CalendarDateParts | null {
  const monthFirst = WRITTEN_MONTH_FIRST_PATTERN.exec(value)
  if (monthFirst) {
    const month = getMonthNumber(monthFirst[1])
    return month ? { year: Number(monthFirst[3]), month, day: Number(monthFirst[2]) } : null
  }

  const dayFirst = WRITTEN_DAY_FIRST_PATTERN.exec(value)
  if (!dayFirst) return null

  const month = getMonthNumber(dayFirst[2])
  return month ? { year: Number(dayFirst[3]), month, day: Number(dayFirst[1]) } : null
}

/**
 * Reads an English month name or its three-letter abbreviation as a month number, or null when the
 * word names no month
 */
function getMonthNumber(name: string) {
  const lowered = name.toLowerCase()
  const index = MONTH_NAMES.findIndex(
    (month) => month === lowered || month.slice(0, MONTH_ABBREVIATION_LENGTH) === lowered,
  )

  return index === -1 ? null : index + 1
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
 * Reports whether a cell holds a date the import could read under any format
 *
 * This is the question auto-detection asks while working out which column holds the dates, before
 * anyone has chosen a format. Judging a column against the chosen format is what the scan does
 */
export function isValidDateValue(value: string) {
  return IMPORT_DATE_FORMATS.some((format) => Boolean(readImportDate(value, format)))
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
