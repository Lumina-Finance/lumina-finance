import type { ImportAmountSignConvention } from '@/pages/imports/types'
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
 * Splits a value into calendar parts under one format, without judging whether they are a real date
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

// An optional sign, then either plain digits or digits grouped in threes by commas, then an
// optional decimal part. Currency symbols, spaces between digits and brackets around negatives
// are all refused rather than cleaned up, because guessing at them risks importing an amount the
// file never stated. The groups are the sign, the whole part and the decimal digits
const IMPORT_NUMBER_PATTERN = /^([+-]?)(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d+))?$/

// The bounds of the signed 64-bit column the backend stores an amount in. The negative side
// reaches one further than the positive, which is what two's complement holds, so a caller that
// negates an amount has to bound its own result. The same two values are written out again in
// backend/app/utils/money.py, and the two have to agree
const MIN_IMPORT_MINOR_UNITS = -(2n ** 63n)
export const MAX_IMPORT_MINOR_UNITS = 2n ** 63n - 1n

/**
 * Why an amount cell could not be converted, so the caller can say which rule it broke rather
 * than only that it failed
 */
export type ImportAmountRefusal = 'unreadable' | 'tooPrecise' | 'tooLarge'

/**
 * Converts an amount cell into the whole minor units the backend stores
 *
 * The decimal point is moved through the digits rather than the value being multiplied, so an
 * amount binary floating point cannot hold exactly still converts to the digits the file states.
 * The result is a bigint because the largest storable amount is past the range a number holds
 * exactly, and agreeing with the backend at that boundary is the point of the conversion
 *
 * @param rawValue - The raw cell value, which may carry a sign and commas grouping the thousands
 * @param exponent - Decimal places of the currency the row will be stored in
 * @returns The amount in minor units, or which of the three rules the cell broke
 */
export function toImportMinorUnits(rawValue: string, exponent: number): bigint | ImportAmountRefusal {
  const match = IMPORT_NUMBER_PATTERN.exec(rawValue.trim())
  if (!match) return 'unreadable'

  const [, sign, whole, fraction = ''] = match

  // Digits past the currency's places can only be dropped when they are zeros, since anything
  // else is a value the currency cannot express, which the backend refuses outright
  const kept = fraction.slice(0, exponent)
  if (/[^0]/.test(fraction.slice(exponent))) return 'tooPrecise'

  const scaled = BigInt(`${whole.replace(/,/g, '')}${kept.padEnd(exponent, '0')}`)
  const minorUnits = sign === '-' ? -scaled : scaled

  return minorUnits >= MIN_IMPORT_MINOR_UNITS && minorUnits <= MAX_IMPORT_MINOR_UNITS ? minorUnits : 'tooLarge'
}

/**
 * Reports whether a code is a currency the app supports, meaning one the API served
 *
 * The browser cannot answer this. Its number formatter checks that a code is three letters and
 * accepts any that are, so ZZZ, CUR and AMT all pass it
 *
 * @param currency - The raw cell value
 * @param supportedCodes - Upper-case codes taken from the currency list the API served
 */
export function isSupportedCurrency(currency: string, supportedCodes: Set<string>) {
  return supportedCodes.has(currency.trim().toUpperCase())
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
 * Reads an amount from an imported cell as a plain number, or null when the cell is not one
 *
 * This answers whether a cell is an amount at all, and its sign, which is all the callers that
 * classify a column or guess a category kind need. Converting an amount for storage is
 * toImportMinorUnits above, which is exact where this is not
 */
export function parseImportNumber(value: string) {
  const normalized = value.trim()
  if (!IMPORT_NUMBER_PATTERN.test(normalized)) return null

  const parsed = Number(normalized.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Rewrites an amount cell to run the way its column and that column's convention say, without
 * touching its digits
 *
 * A cell whose sign matches the convention runs the way its column does. One carrying the other sign
 * runs the other way, which is how a refund sits in a column of purchases and a reversed deposit in
 * a column of deposits. Only a minus counts as a sign here, so a value written `+45.00` reads the
 * same as `45.00`
 *
 * The sign is replaced rather than added in front, because prefixing a minus onto a cell that
 * already carries one gives `--12.00`, and onto a cell written `+5.00` gives `-+5.00`, neither of
 * which this module's pattern nor the backend's matching one reads. Everything after the sign is
 * left exactly as the file wrote it, thousands separators included, since the commit sends the
 * string for the API to parse with exact decimals
 *
 * A zero is written without a sign, because it runs neither way
 *
 * @param value - The raw cell value, which the caller has already read as an amount
 * @param direction - Which way the column the cell sits in holds money
 * @param convention - Which sign that column writes its own direction with
 * @returns The amount as the payload carries it. An empty string where the value is not an amount
 * after all, which the type needs and no caller can reach
 */
export function applyImportAmountDirection(
  value: string,
  direction: 'out' | 'in',
  convention: ImportAmountSignConvention,
) {
  const match = IMPORT_NUMBER_PATTERN.exec(value.trim())
  if (!match) return ''

  const [, sign, whole, fraction] = match
  const digits = fraction === undefined ? whole : `${whole}.${fraction}`

  const doesCellRunWithColumn = (sign === '-') === (convention === 'negative')
  const isMoneyOut = doesCellRunWithColumn === (direction === 'out')

  return isMoneyOut && parseImportNumber(value) !== 0 ? `-${digits}` : digits
}

/**
 * Shortens a cell value for display, keeping the first 25 characters and adding an ellipsis once the
 * value runs past 28 characters so table columns stay an even width
 */
export function truncateValue(value: string) {
  return value.length > 28 ? `${value.slice(0, 25)}...` : value
}
