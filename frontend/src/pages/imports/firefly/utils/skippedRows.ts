import type { FireflySkippedRow } from '@/api/dataImports'
import type { CsvRow } from '../../types'
import { FIREFLY_MISSING_REQUIRED_VALUES_REASON } from '../constants'
import { getFireflyMissingRequiredFields } from './derivation'
import { resolveFireflyRowLegs, type FireflyRowResolutionOptions } from './rowResolution'

// Line numbers count the header line of the uploaded file, so the first
// parsed data row sits on line 2
const FIRST_DATA_ROW_LINE_NUMBER = 2

/**
 * One journal row the import will not convert, carrying its line number in
 * the uploaded file, the raw export cells shown to the user, and the
 * backend-worded skip reason
 */
export interface FireflySkippedRowDetail {
  journalId: string
  rowNumber: number | null
  cells: CsvRow | null
  reason: string
}

/**
 * Everything the preview predicts about a commit in one pass over the rows
 */
export interface FireflyImportForecast {
  rowCount: number
  transactionEstimate: number
  skippedRows: FireflySkippedRowDetail[]
}

/**
 * Resolves every journal row once to predict the commit outcome: the rows
 * that will convert, the ledger transactions they produce, and the rows the
 * commit will skip paired with the reasons the backend will report
 */
export function forecastFireflyImport(
  rows: CsvRow[],
  options: FireflyRowResolutionOptions,
): FireflyImportForecast {
  const skippedRows: FireflySkippedRowDetail[] = []
  let rowCount = 0
  let transactionEstimate = 0

  for (const [index, row] of rows.entries()) {
    // Rows missing identity fields never reach the backend because the
    // payload builder drops them before upload, so the reason names the
    // fields the user has to fix in the file
    const missingFields = getFireflyMissingRequiredFields(row)
    if (missingFields.length > 0) {
      skippedRows.push(buildFireflySkippedRowDetail(
        row,
        index,
        `${FIREFLY_MISSING_REQUIRED_VALUES_REASON}: ${missingFields.join(', ')}`,
      ))
      continue
    }
    rowCount += 1

    const resolution = resolveFireflyRowLegs(row, options)
    if (resolution.skipReason !== null) {
      skippedRows.push(buildFireflySkippedRowDetail(row, index, resolution.skipReason))
    } else {
      transactionEstimate += resolution.legs.length
    }
  }

  return { rowCount, transactionEstimate, skippedRows }
}

/**
 * Joins the backend skip entries back to the parsed export rows by journal
 * id so the results table can show the file line numbers and raw cells,
 * falling back to the id and reason when a journal id is not found
 */
export function enrichFireflySkippedRows(
  skipped: FireflySkippedRow[],
  rows: CsvRow[],
): FireflySkippedRowDetail[] {
  // The row position is needed alongside the row itself to derive the line
  // number in the uploaded file, so the join keeps the index per journal id
  const rowIndexByJournalId = new Map<string, number>()
  for (const [index, row] of rows.entries()) {
    const journalId = row.journal_id?.trim()
    if (journalId && !rowIndexByJournalId.has(journalId)) rowIndexByJournalId.set(journalId, index)
  }

  return skipped.map((entry) => {
    const index = rowIndexByJournalId.get(entry.journal_id)
    if (index === undefined) {
      return { journalId: entry.journal_id, rowNumber: null, cells: null, reason: entry.reason }
    }
    return buildFireflySkippedRowDetail(rows[index], index, entry.reason)
  })
}

/**
 * Shapes one parsed export row into the skipped-row detail the table renders
 */
function buildFireflySkippedRowDetail(row: CsvRow, index: number, reason: string): FireflySkippedRowDetail {
  return {
    journalId: row.journal_id?.trim() ?? '',
    rowNumber: index + FIRST_DATA_ROW_LINE_NUMBER,
    cells: row,
    reason,
  }
}
