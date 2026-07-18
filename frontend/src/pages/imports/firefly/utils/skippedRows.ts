import type { CsvRow } from '../../types'
import { FIREFLY_MISSING_REQUIRED_VALUES_REASON, FIREFLY_TAG_TOO_LONG_REASON } from '../constants'
import { getFireflyMissingRequiredFields, getFireflyOverlongTag } from './derivation'
import { resolveFireflyRowLegs, type FireflyRowResolutionOptions } from './rowResolution'

// How much of an overlong tag the skip reason shows, mirroring the backend's
// own truncation of tag names in error details
const OVERLONG_TAG_PREVIEW_LENGTH = 28

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
  // True when the payload builder drops the row before upload, so the commit
  // response never reports it and the results have to add it back
  droppedBeforeUpload: boolean
}

/**
 * Everything the preview predicts about a commit in one pass over the rows,
 * where rowCount covers every parsed row so the row count minus the skipped
 * rows is the number that converts
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
    rowCount += 1

    // Rows missing identity fields never reach the backend because the
    // payload builder drops them before upload, so the reason names the
    // fields the user has to fix in the file
    const missingFields = getFireflyMissingRequiredFields(row)
    if (missingFields.length > 0) {
      skippedRows.push(buildFireflySkippedRowDetail(
        row,
        index,
        `${FIREFLY_MISSING_REQUIRED_VALUES_REASON}: ${missingFields.join(', ')}`,
        { droppedBeforeUpload: true },
      ))
      continue
    }

    // A tag past Lumina's length cap would fail the whole upload batch on
    // the backend, so the row is dropped before upload with the tag named
    const overlongTag = getFireflyOverlongTag(row)
    if (overlongTag !== null) {
      skippedRows.push(buildFireflySkippedRowDetail(
        row,
        index,
        `${FIREFLY_TAG_TOO_LONG_REASON}: ${overlongTag.slice(0, OVERLONG_TAG_PREVIEW_LENGTH)}`,
        { droppedBeforeUpload: true },
      ))
      continue
    }

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
 * Shapes one parsed export row into the skipped-row detail the table renders
 */
function buildFireflySkippedRowDetail(
  row: CsvRow,
  index: number,
  reason: string,
  { droppedBeforeUpload = false }: { droppedBeforeUpload?: boolean } = {},
): FireflySkippedRowDetail {
  return {
    journalId: row.journal_id?.trim() ?? '',
    rowNumber: index + FIRST_DATA_ROW_LINE_NUMBER,
    cells: row,
    reason,
    droppedBeforeUpload,
  }
}
