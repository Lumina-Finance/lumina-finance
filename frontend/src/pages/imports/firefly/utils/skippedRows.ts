import type { CsvRow, ImportRowProblem } from '@/pages/imports/types'
import { FIREFLY_MISSING_REQUIRED_VALUES_REASON, FIREFLY_TAG_TOO_LONG_REASON } from '@/pages/imports/firefly/constants'
import { getImportRowId } from '@/pages/imports/utils/common'
import { getDebtPaymentImportNote } from '@/pages/imports/utils/categoryMatching'
import {
  getFireflyMissingRequiredFields,
  getFireflyOverlongTag,
  getFireflyRowOverLimitReason,
} from './derivation'
import {
  getFireflyCategoryUsedByResolution,
  resolveFireflyRowLegs,
  type FireflyRowResolutionOptions,
} from './rowResolution'

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
 * Everything the preview predicts about a commit in one pass over the rows, including skipped rows
 * and non-blocking guidance for rows that will convert
 */
export interface FireflyImportForecast {
  rowCount: number
  transactionEstimate: number
  skippedRows: FireflySkippedRowDetail[]
  rowWarnings: ImportRowProblem[]
}

/** Resolution options paired with the staged file that gives source rows their identity */
export interface FireflyImportForecastOptions extends FireflyRowResolutionOptions {
  fileId: string | null
}

/**
 * Resolves every journal row once to predict its transaction count, skip reason and guidance
 */
export function forecastFireflyImport(
  rows: CsvRow[],
  options: FireflyImportForecastOptions,
): FireflyImportForecast {
  const skippedRows: FireflySkippedRowDetail[] = []
  const rowWarnings: ImportRowProblem[] = []
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

    // Notes or a tag count past what one transaction holds would fail the
    // whole upload batch, and the batches already sent stay in the ledger, so
    // the row is dropped before upload with the count named
    const overLimitReason = getFireflyRowOverLimitReason(row)
    if (overLimitReason !== null) {
      skippedRows.push(buildFireflySkippedRowDetail(row, index, overLimitReason, { droppedBeforeUpload: true }))
      continue
    }

    const resolution = resolveFireflyRowLegs(row, options)
    if (resolution.skipReason !== null) {
      skippedRows.push(buildFireflySkippedRowDetail(row, index, resolution.skipReason))
    } else {
      transactionEstimate += resolution.legs.length

      const category = getFireflyCategoryUsedByResolution(row, resolution.legs, options)
      const debtPaymentNote = getDebtPaymentImportNote(category)
      if (debtPaymentNote && options.fileId) {
        rowWarnings.push({
          id: getImportRowId(options.fileId, index),
          rowNumber: index + FIRST_DATA_ROW_LINE_NUMBER,
          cells: row,
          reason: debtPaymentNote,
        })
      }
    }
  }

  return { rowCount, transactionEstimate, skippedRows, rowWarnings }
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
