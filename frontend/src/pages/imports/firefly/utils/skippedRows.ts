import type { FireflyImportRunResponse } from '@/api/firefly-imports'
import type { CsvRow, ImportRowProblem } from '@/pages/imports/types'
import { FIREFLY_MISSING_REQUIRED_VALUES_REASON, FIREFLY_TAG_TOO_LONG_REASON } from '@/pages/imports/firefly/constants'
import { getImportRowId } from '@/pages/imports/utils/common'
import { getDebtPaymentImportNote } from '@/pages/imports/utils/categoryMatching'
import {
  getFireflyMissingRequiredFields,
  getFireflyOverlongTag,
  getFireflyRowOverLimitReason,
  getFireflyRowShapeSkipReason,
  getFireflySplitGroupSizes,
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
 * One journal row the import leaves out, carrying its line number in the uploaded file, the raw
 * export cells shown to the user, and the reason in the words the server would use
 *
 * The server refuses a row it cannot write rather than skipping it, so every row predicted here is
 * left out of the upload by the browser
 */
export interface FireflySkippedRowDetail {
  journalId: string
  rowNumber: number
  cells: CsvRow
  reason: string
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

/** What one completed import wrote, with what it left out, captured when it started */
export interface FireflyCompletedImportContext {
  result: FireflyImportRunResponse
  skippedRowsAtCommit: FireflySkippedRowDetail[]
}

/**
 * Selects the skipped rows the preview table shows before or after commit
 */
export function getFireflySkippedRowsDisplay({
  liveForecastRows,
  completedImport,
}: {
  liveForecastRows: FireflySkippedRowDetail[]
  completedImport: FireflyCompletedImportContext | null
}) {
  const rows = completedImport?.skippedRowsAtCommit ?? liveForecastRows
  const totalCount = rows.length
  const plural = totalCount === 1 ? '' : 's'
  return {
    rows,
    totalCount,
    title: completedImport
      ? `${totalCount} row${plural} ${totalCount === 1 ? 'was' : 'were'} not imported`
      : `${totalCount} row${plural} will not be imported`,
  }
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
  const groupSizes = getFireflySplitGroupSizes(rows)

  for (const [index, row] of rows.entries()) {
    rowCount += 1

    // A row missing identity fields is left out, and the reason names the fields the user has to
    // fix in the file
    const missingFields = getFireflyMissingRequiredFields(row)
    if (missingFields.length > 0) {
      skippedRows.push(buildFireflySkippedRowDetail(
        row,
        index,
        `${FIREFLY_MISSING_REQUIRED_VALUES_REASON}: ${missingFields.join(', ')}`,
      ))
      continue
    }

    // A row whose endpoints leave it nothing to write is skipped whatever the mappings
    const shapeSkipReason = getFireflyRowShapeSkipReason(row)
    if (shapeSkipReason !== null) {
      skippedRows.push(buildFireflySkippedRowDetail(row, index, shapeSkipReason))
      continue
    }

    // A tag past Lumina's length cap would fail the whole import, so the row is left out with the
    // tag named
    const overlongTag = getFireflyOverlongTag(row)
    if (overlongTag !== null) {
      skippedRows.push(buildFireflySkippedRowDetail(
        row,
        index,
        `${FIREFLY_TAG_TOO_LONG_REASON}: ${overlongTag.slice(0, OVERLONG_TAG_PREVIEW_LENGTH)}`,
      ))
      continue
    }

    // A value past what the import takes would fail the whole import, so the row is left out
    // with the value named
    const overLimitReason = getFireflyRowOverLimitReason(row, groupSizes)
    if (overLimitReason !== null) {
      skippedRows.push(buildFireflySkippedRowDetail(row, index, overLimitReason))
      continue
    }

    // The rest are what the server would refuse, and it fails the whole commit on one, so these
    // are left out too, with the reason the server would give
    const resolution = resolveFireflyRowLegs(row, options)
    if (resolution.skipReason !== null) {
      skippedRows.push(buildFireflySkippedRowDetail(row, index, resolution.skipReason))
    } else if (resolution.legs) {
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
function buildFireflySkippedRowDetail(row: CsvRow, index: number, reason: string): FireflySkippedRowDetail {
  return {
    journalId: row.journal_id?.trim() ?? '',
    rowNumber: index + FIRST_DATA_ROW_LINE_NUMBER,
    cells: row,
    reason,
  }
}
