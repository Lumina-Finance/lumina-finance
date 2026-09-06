import type { ColumnMap, ImportFileDraft } from '@/pages/imports/types'
import {
  IMPORT_AMOUNT_FORMATS,
  type ImportAmountFormat,
  type ImportAmountReading,
  readImportAmount,
} from './amountFormats'
import {
  IMPORT_DATE_FORMATS,
  type ImportDateFormat,
  type ImportDateSeparator,
  readImportDate,
} from './valueParsers'

export interface ImportAmountFormatScan {
  readable: ImportAmountFormat[]
  rejectedBy: Partial<Record<string, string>>
  automatic: ImportAmountFormat | null
  ambiguous: boolean
}

export interface ImportDateChoiceScan {
  readable: ImportDateFormat[]
  rejectedBy: Partial<Record<ImportDateFormat, string>>
  automatic: ImportDateFormat | null
  ambiguous: boolean
}

export interface ImportFormatChoiceState<T> {
  scope: string
  chosen: T | null
}

/** Starts a format choice with no explicit answer */
export function createImportFormatChoiceState<T>(scope: string): ImportFormatChoiceState<T> {
  return { scope, chosen: null }
}

/**
 * Moves a format choice to its active file and columns
 *
 * A changed scope clears the explicit answer in the returned state. Since the state records the
 * intermediate scope, returning from A to B and then A cannot restore A's previous answer
 */
export function moveImportFormatChoiceToScope<T>(
  state: ImportFormatChoiceState<T>,
  scope: string,
): ImportFormatChoiceState<T> {
  return state.scope === scope ? state : createImportFormatChoiceState(scope)
}

/** Records an explicit format answer under the active scope */
export function chooseImportFormat<T>(scope: string, chosen: T): ImportFormatChoiceState<T> {
  return { scope, chosen }
}

/** Uses the explicit choice when it applies, or the automatic choice when it does not */
export function resolveImportFormatChoice<T>(
  state: ImportFormatChoiceState<T>,
  scope: string,
  automatic: T | null,
) {
  return state.scope === scope && state.chosen !== null ? state.chosen : automatic
}

/** Builds the scope for one date column and the files that supply it */
export function buildImportDateFormatScope(columnMap: ColumnMap, files: ImportFileDraft[]) {
  return buildImportFormatScope(files, [columnMap.dt])
}

/** Builds one shared scope for every column that can supply a row's amount */
export function buildImportAmountFormatScope(columnMap: ColumnMap, files: ImportFileDraft[]) {
  return buildImportFormatScope(files, [columnMap.amount, columnMap.amount_out, columnMap.amount_in])
}

/** Returns every value governed by the one shared amount choice */
export function getImportAmountFormatValues(columnMap: ColumnMap, files: ImportFileDraft[]) {
  const headers = [columnMap.amount, columnMap.amount_out, columnMap.amount_in].filter(Boolean)
  return files.flatMap((file) => file.rows.flatMap((row) => headers.map((header) => row[header] ?? '')))
}

/**
 * Scans every supported amount format and chooses one only when all viable readings agree
 *
 * @param values - Every cell governed by the shared amount choice, including blanks
 */
export function scanImportAmountFormatChoices(values: string[]): ImportAmountFormatScan {
  const filled = values.map((value) => value.trim()).filter(Boolean)
  const readable: ImportAmountFormat[] = []
  const rejectedBy: Partial<Record<string, string>> = {}
  const readings: ImportAmountReading[][] = []

  for (const format of IMPORT_AMOUNT_FORMATS) {
    const candidateReadings: ImportAmountReading[] = []
    const offender = filled.find((value) => {
      const reading = readImportAmount(value, format)
      if (reading) candidateReadings.push(reading)
      return reading === null
    })

    if (offender === undefined) {
      readable.push(format)
      readings.push(candidateReadings)
    } else {
      rejectedBy[getImportAmountFormatKey(format)] = offender
    }
  }

  const automatic = filled.length > 0 && readingsAgree(readings.map(
    (candidate) => candidate.map((reading) => reading.normalized),
  ))
    ? (readable[0] ?? null)
    : null

  return {
    readable,
    rejectedBy,
    automatic,
    ambiguous: readable.length > 0 && automatic === null,
  }
}

/** Scans date orders under one separator policy and chooses only an agreed interpretation */
export function scanImportDateFormatChoices(
  values: string[],
  separator: ImportDateSeparator = 'automatic',
): ImportDateChoiceScan {
  const filled = values.map((value) => value.trim()).filter(Boolean)
  const readable: ImportDateFormat[] = []
  const rejectedBy: Partial<Record<ImportDateFormat, string>> = {}
  const readings: string[][] = []

  for (const format of IMPORT_DATE_FORMATS) {
    const candidateReadings: string[] = []
    const offender = filled.find((value) => {
      const reading = readImportDate(value, format, separator)
      if (reading) candidateReadings.push(reading)
      return !reading
    })

    if (offender === undefined) {
      readable.push(format)
      readings.push(candidateReadings)
    } else {
      rejectedBy[format] = offender
    }
  }

  const automatic = filled.length > 0 && readingsAgree(readings) ? (readable[0] ?? null) : null
  return {
    readable,
    rejectedBy,
    automatic,
    ambiguous: readable.length > 0 && automatic === null,
  }
}

/** Gives a separator pair a stable key for refusal lookup and controls */
export function getImportAmountFormatKey(format: ImportAmountFormat) {
  return `${format.decimalSeparator}:${format.groupingSeparator}`
}

/** Builds a collision-safe choice scope from file identities and relevant mapped headers */
function buildImportFormatScope(files: ImportFileDraft[], headers: string[]) {
  return JSON.stringify([files.map((file) => file.id), headers])
}

/** Reports whether every viable candidate gives every row the same normalized value */
function readingsAgree(readings: string[][]) {
  if (readings.length === 0) return false
  const expected = readings[0]
  return readings.every(
    (candidate) => candidate.length === expected.length
      && candidate.every((value, index) => value === expected[index]),
  )
}
