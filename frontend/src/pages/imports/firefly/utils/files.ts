import type { ImportFileDraft } from '../../types'
import { readCsvFile } from '../../utils'
import {
  FIREFLY_BUDGETS_REQUIRED_HEADERS,
  FIREFLY_TRANSACTIONS_REQUIRED_HEADERS,
} from '../constants'
import type { FireflyFileKind } from '../types'

const REQUIRED_HEADERS_BY_KIND: Record<FireflyFileKind, string[]> = {
  transactions: FIREFLY_TRANSACTIONS_REQUIRED_HEADERS,
  budgets: FIREFLY_BUDGETS_REQUIRED_HEADERS,
}

/**
 * Reads one Firefly III export file and flags missing required columns
 */
export async function readFireflyCsvFile(file: File, kind: FireflyFileKind): Promise<ImportFileDraft> {
  const draft = await readCsvFile(file)
  if (draft.error) return draft

  const headers = new Set(draft.headers)
  const missing = REQUIRED_HEADERS_BY_KIND[kind].filter((header) => !headers.has(header))
  if (missing.length > 0) {
    return { ...draft, error: `Not a Firefly III ${kind} export, missing columns: ${missing.join(', ')}` }
  }

  return draft
}

/**
 * Gets the usable rows of a validated Firefly III export file
 */
export function getFireflyFileRows(file: ImportFileDraft | null) {
  return file && !file.error ? file.rows : []
}

/**
 * Gets the column headers of a validated Firefly III export file in their
 * original order, falling back to the first row's keys when the draft
 * carries no header list
 */
export function getFireflyFileHeaders(file: ImportFileDraft | null): string[] {
  if (!file || file.error) return []
  if (file.headers.length > 0) return file.headers

  const [firstRow] = file.rows
  return firstRow ? Object.keys(firstRow) : []
}
