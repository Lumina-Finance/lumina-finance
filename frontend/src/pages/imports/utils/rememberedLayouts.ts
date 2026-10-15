import type { CsvImportLayout, SavedCsvImportLayout } from '@/api/transaction-imports'
import { COLUMN_TARGETS, EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import type { ColumnMap, ColumnTarget, ImportFileDraft } from '@/pages/imports/types'
import { IMPORT_AMOUNT_FORMATS, type ImportAmountFormat } from './amountFormats'
import { IMPORT_DELIMITERS, MAX_IMPORT_ROWS, type CsvLayoutReading } from './csv'
import { IMPORT_DATE_FORMATS, type ImportDateFormat } from './valueParsers'

// The server's bounds on a saved layout, MAX_CSV_LAYOUT_COLUMNS, MAX_CSV_LAYOUT_HEADER_LENGTH and
// MAX_CSV_LAYOUT_LINE in its import run schemas. A file past them is left unremembered here, since a
// layout the server refuses would refuse the import carrying it
const MAX_LAYOUT_COLUMNS = 256
const MAX_LAYOUT_HEADER_LENGTH = 256
const MAX_LAYOUT_LINE = MAX_IMPORT_ROWS

// The fields a layout keeps. The account is what a layout is saved under, so it never keeps that column
const REMEMBERED_TARGETS = new Set<string>(COLUMN_TARGETS.map((target) => target.id).filter((id) => id !== 'account_id'))

/** The column mapping and formats a saved layout applies to a file with its headers */
export type RememberedImportSettings = {
  columnMap: ColumnMap
  dateFormat: ImportDateFormat
  amountFormat: ImportAmountFormat
}

/**
 * A layout saved for one of the user's accounts, in the page's own terms
 *
 * Its settings are all ones the page offers, since a layout naming a format or field it doesn't is left
 * out rather than applied in part
 */
export type RememberedImportLayout = CsvLayoutReading & {
  accountId: string
  settings: RememberedImportSettings
}

/**
 * Builds the layout an import saves from the staged file and the answers it was imported with
 *
 * @returns The layout, or null for a file the import saves none for: one read without a header row,
 *   and one past the server's bounds
 */
export function buildCsvImportLayout(
  file: ImportFileDraft,
  columnMap: ColumnMap,
  dateFormat: ImportDateFormat,
  amountFormat: ImportAmountFormat,
): CsvImportLayout | null {
  const headerRow = file.reading?.headerRow
  if (!file.hasHeaderRow || !headerRow || !file.delimiter) return null

  const isWithinBounds = file.headers.length <= MAX_LAYOUT_COLUMNS
    && file.headers.every((header) => header.length <= MAX_LAYOUT_HEADER_LENGTH)
    && headerRow <= MAX_LAYOUT_LINE
  if (!isWithinBounds) return null

  return {
    headers: file.headers,
    delimiter: file.delimiter,
    header_row: headerRow,
    column_map: Object.fromEntries(
      Object.entries(columnMap).filter(([target, header]) => header && REMEMBERED_TARGETS.has(target)),
    ),
    date_format: dateFormat,
    amount_format: {
      decimal_separator: amountFormat.decimalSeparator,
      grouping_separator: amountFormat.groupingSeparator,
    },
  }
}

/**
 * Reads saved layouts into the page's own terms, leaving out one whose separator, format or field the
 * page no longer offers, so a file with its headers is read by detection as if none were saved
 */
export function readSavedImportLayouts(saved: SavedCsvImportLayout[]): RememberedImportLayout[] {
  return saved.flatMap((layout) => {
    const delimiter = IMPORT_DELIMITERS.find((candidate) => candidate === layout.delimiter)
    const settings = readSavedSettings(layout)
    if (!delimiter || !settings) return []

    return [{
      accountId: layout.account_id,
      headers: layout.headers,
      delimiter,
      headerRow: layout.header_row,
      settings,
    }]
  })
}

/**
 * The column mapping and formats a saved layout holds, or null when it names one the page doesn't offer
 */
function readSavedSettings(layout: SavedCsvImportLayout): RememberedImportSettings | null {
  const dateFormat = IMPORT_DATE_FORMATS.find((format) => format === layout.date_format)
  const amountFormat = IMPORT_AMOUNT_FORMATS.find((format) => (
    format.decimalSeparator === layout.amount_format.decimal_separator
    && format.groupingSeparator === layout.amount_format.grouping_separator
  ))
  const entries = Object.entries(layout.column_map)
  if (!dateFormat || !amountFormat || !entries.every(([target]) => REMEMBERED_TARGETS.has(target))) return null

  const columnMap: ColumnMap = { ...EMPTY_COLUMN_MAP }
  for (const [target, header] of entries) columnMap[target as ColumnTarget] = header
  return { columnMap, dateFormat, amountFormat }
}
