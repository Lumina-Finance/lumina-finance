import type { FireflyTransactionImportResponse } from '@/api/firefly-imports'
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

/** Result and skipped-row prediction captured together for one completed transaction import */
export interface FireflyCompletedImportContext {
  result: FireflyTransactionImportResponse
  predictedSkippedRowsAtCommit: FireflySkippedRowDetail[]
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
  if (completedImport) return getCompletedFireflySkippedRowsDisplay(completedImport)

  const totalCount = liveForecastRows.length
  return {
    rows: liveForecastRows,
    totalCount,
    title: `${totalCount} row${totalCount === 1 ? '' : 's'} will not be imported`,
  }
}

/** Reconciles exact committed counts with the available browser and server detail samples */
function getCompletedFireflySkippedRowsDisplay({
  result,
  predictedSkippedRowsAtCommit,
}: FireflyCompletedImportContext) {
  const browserDroppedRows = predictedSkippedRowsAtCommit.filter((row) => row.droppedBeforeUpload)
  const uploadedForecastByPair = new Map<string, FireflySkippedRowDetail[]>()
  for (const row of predictedSkippedRowsAtCommit) {
    if (row.droppedBeforeUpload) continue
    const key = getFireflySkipPairKey(row.journalId, row.reason)
    const matches = uploadedForecastByPair.get(key)
    if (matches) {
      matches.push(row)
    } else {
      uploadedForecastByPair.set(key, [row])
    }
  }

  const returnedCountByPair = new Map<string, number>()
  for (const row of result.skipped) {
    const key = getFireflySkipPairKey(row.journal_id, row.reason)
    returnedCountByPair.set(key, (returnedCountByPair.get(key) ?? 0) + 1)
  }

  const serverRows = result.skipped.map((row) => {
    const key = getFireflySkipPairKey(row.journal_id, row.reason)
    const forecastMatches = uploadedForecastByPair.get(key) ?? []
    if (forecastMatches.length === 1 && returnedCountByPair.get(key) === 1) {
      return {
        ...forecastMatches[0],
        journalId: row.journal_id,
        reason: row.reason,
        droppedBeforeUpload: false,
      }
    }

    return {
      journalId: row.journal_id,
      rowNumber: null,
      cells: null,
      reason: row.reason,
      droppedBeforeUpload: false,
    }
  })

  const rows = [...browserDroppedRows, ...serverRows]
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      if (left.row.rowNumber === null) return right.row.rowNumber === null ? left.index - right.index : 1
      if (right.row.rowNumber === null) return -1
      return left.row.rowNumber - right.row.rowNumber || left.index - right.index
    })
    .map(({ row }) => row)
  const totalCount = browserDroppedRows.length + result.rows_skipped

  return {
    rows,
    totalCount,
    title: `${totalCount} row${totalCount === 1 ? '' : 's'} ${totalCount === 1 ? 'was' : 'were'} not imported`,
  }
}

/** Builds an unambiguous key from the journal ID and returned reason pair */
function getFireflySkipPairKey(journalId: string, reason: string) {
  return JSON.stringify([journalId, reason])
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

    // A value past what the import endpoint takes would fail the whole upload
    // batch, and the batches already sent stay in the ledger, so the row is
    // dropped before upload with the value named
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
