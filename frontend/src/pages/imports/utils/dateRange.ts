import type { ColumnMap, ImportDateRange, ImportFileDraft, ImportRowFilter } from '@/pages/imports/types'
import type { TransactionFilters } from '@/api/transactions'
import { addDays, formatYmd, isDateRangeCrossed, parseYmd } from '@/utils/date'
import { includeEveryImportRow } from './common'
import { readImportRowDate } from './rowResolution'
import type { ImportDateFormat, ImportDateSeparator } from './valueParsers'

/** No limit on either side, which is where every import starts */
export const WHOLE_FILE_DATE_RANGE: ImportDateRange = { from: '', to: '' }

/**
 * Reports whether the chosen dates exclude each other, which only counts while a date column is
 * mapped, since the fields are only shown then
 */
export function isImportDateRangeCrossed(columnMap: ColumnMap, { from, to }: ImportDateRange) {
  return Boolean(columnMap.dt) && from !== null && to !== null && isDateRangeCrossed({ from, to })
}

/**
 * Reports whether either chosen date is only partly typed, which blocks the import rather than
 * reading as no limit, since importing past a date the user meant to set writes rows they didn't want
 */
export function isImportDateRangeIncomplete(columnMap: ColumnMap, { from, to }: ImportDateRange) {
  return Boolean(columnMap.dt) && (from === null || to === null)
}

/**
 * Builds the test deciding which rows the chosen dates keep
 *
 * A row is left out only where its date reads and falls outside the range. A row whose date cannot
 * be read stays in, so it is still listed as a problem row whatever the range is
 *
 * @returns Every row while no range is chosen or no date column is mapped, and null while a chosen
 *   range cannot be applied: before the date format is settled, while a date is only partly typed,
 *   or while its ends are crossed. Which rows fall outside is then unknown, which is not the same as
 *   none
 */
export function getImportDateRangeFilter({
  columnMap,
  dateFormat,
  dateSeparator,
  timeZone,
  dateRange,
}: {
  columnMap: ColumnMap
  dateFormat: ImportDateFormat | null
  dateSeparator?: ImportDateSeparator
  timeZone?: string
  dateRange: ImportDateRange
}): ImportRowFilter | null {
  const { from, to } = dateRange
  if (!columnMap.dt) return includeEveryImportRow
  if (from === null || to === null || isDateRangeCrossed({ from, to })) return null
  if (!from && !to) return includeEveryImportRow
  if (!dateFormat) return null

  return (row) => {
    // Read the way the commit reads it, so a timestamp converted into the profile timezone is kept
    // or left out by the day it will be saved under
    const dt = readImportRowDate(row, { columnMap, dateFormat, dateSeparator, timeZone })
    if (!dt) return true
    return (!from || dt >= from) && (!to || dt <= to)
  }
}

/**
 * Counts the rows the chosen dates leave out, or null while which ones is unknown
 *
 * @param filter - What `getImportDateRangeFilter` returned for these files
 */
export function countImportRowsOutsideDateRange(files: ImportFileDraft[], filter: ImportRowFilter | null) {
  if (filter === null) return null
  return files.reduce((total, file) => total + file.rows.filter((row) => !filter(row)).length, 0)
}

/**
 * Sets one end of the range, keeping the range itself where that end already holds the value
 *
 * The date field reports a partly typed end on every keystroke until the date is whole, and the
 * import's answers are compared by identity, so a new range for an unchanged value would read as the
 * user changing an answer
 *
 * @param value - What the date field reports: the whole date, or empty while it holds no whole date
 * @param isPartlyTyped - Whether that empty value is a date begun rather than a field cleared, which
 *   is held as null so it blocks the import instead of reading as no limit
 */
export function getNextImportDateRange(
  current: ImportDateRange,
  end: keyof ImportDateRange,
  value: string,
  isPartlyTyped: boolean,
) {
  const next = isPartlyTyped ? null : value
  return current[end] === next ? current : { ...current, [end]: next }
}

/**
 * Builds the list query that finds the newest transaction in one account, or in every account
 */
export function getLatestTransactionFilters(accountId: string | null): TransactionFilters {
  return {
    ...(accountId ? { account_id: [accountId] } : {}),
    sort_by: 'dt',
    sort_order: 'desc',
    limit: 1,
  }
}

/**
 * Works out what the start date can be filled with: the day after the newest transaction
 *
 * A transaction's date is a calendar date, so the next day is counted on the calendar, with no time
 * zone to shift it
 *
 * @param latestDt - The newest transaction's date, null or undefined while there is none or it has
 *   not arrived
 * @returns The start date as year-month-day, null while there is nothing to offer
 */
export function getLatestStartSuggestion(latestDt: string | null | undefined) {
  const latest = latestDt ? parseYmd(latestDt) : null
  return latest ? formatYmd(addDays(latest, 1)) : null
}
