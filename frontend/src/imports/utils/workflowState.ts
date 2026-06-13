import { COLUMN_TARGETS } from '../constants'
import type { ColumnMap, ColumnTarget, ColumnValidationErrors, ImportFileDraft } from '../types'
import { removeRecordKey } from './common'

/**
 * Assigns a CSV header to one import target while clearing any previous target that used the same header
 */
export function getNextColumnMap(columnMap: ColumnMap, header: string, targetValue: string): ColumnMap {
  const next = { ...columnMap }

  for (const target of COLUMN_TARGETS) {
    if (next[target.id] === header) next[target.id] = ''
  }
  if (targetValue) next[targetValue as ColumnTarget] = header

  return next
}

/**
 * Keeps only auto-filled headers that remain mapped and records newly inferred mappings
 */
export function getNextAutoFilledColumnHeaders(
  current: Set<string>,
  previousColumnMap: ColumnMap,
  nextColumnMap: ColumnMap,
): Set<string> {
  const mappedHeaders = new Set(Object.values(nextColumnMap).filter(Boolean))
  const next = new Set([...current].filter((header) => mappedHeaders.has(header)))

  for (const target of COLUMN_TARGETS) {
    const header = nextColumnMap[target.id]
    if (header && previousColumnMap[target.id] !== header) next.add(header)
  }

  return next
}

interface ColumnValidationResult {
  valid: boolean
  message: string
}

/**
 * Updates validation errors after a target assignment, including displaced header cleanup
 */
export function getNextColumnValidationErrors(
  columnValidationErrors: ColumnValidationErrors,
  header: string,
  displacedHeader: string,
  targetValue: string,
  validation: ColumnValidationResult,
): ColumnValidationErrors {
  if (!targetValue) return removeRecordKey(columnValidationErrors, header)

  let next = displacedHeader && displacedHeader !== header
    ? removeRecordKey(columnValidationErrors, displacedHeader)
    : columnValidationErrors

  next = validation.valid
    ? removeRecordKey(next, header)
    : { ...next, [header]: validation.message }

  return next
}

/**
 * Checks that all required columns are mapped and all mapped headers pass validation
 */
export function isColumnMappingComplete(
  columnMap: ColumnMap,
  columnValidationErrors: ColumnValidationErrors,
  files: ImportFileDraft[],
): boolean {
  if (files.length === 0) return false

  const missingRequired = COLUMN_TARGETS.some(
    (target) => target.required && !columnMap[target.id],
  )
  if (missingRequired) return false

  const mappedHeaders = new Set(Object.values(columnMap).filter(Boolean))
  return !Object.keys(columnValidationErrors).some((header) => mappedHeaders.has(header))
}

/**
 * Waits for a minimum duration before changing import progress UI state
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
