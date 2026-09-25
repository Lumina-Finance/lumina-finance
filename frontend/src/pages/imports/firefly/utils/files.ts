import type { ImportFileDraft } from '@/pages/imports/types'
import { readCsvFile } from '@/pages/imports/utils'
import {
  FIREFLY_BUDGETS_REQUIRED_HEADERS,
  FIREFLY_TRANSACTIONS_REQUIRED_HEADERS,
} from '@/pages/imports/firefly/constants'
import type { FireflyFileKind } from '@/pages/imports/firefly/types'

const REQUIRED_HEADERS_BY_KIND: Record<FireflyFileKind, string[]> = {
  transactions: FIREFLY_TRANSACTIONS_REQUIRED_HEADERS,
  budgets: FIREFLY_BUDGETS_REQUIRED_HEADERS,
}

// Firefly III writes its exports through league/csv's formula escaping, which puts this character
// in front of any cell starting with one of the characters below. Every withdrawal amount is one
const FORMULA_ESCAPE = "'"

// The characters league/csv escapes by default. A newline stands in for the carriage return it also
// escapes, because the reader rewrites every carriage return as a newline before parsing
const FORMULA_TRIGGERS = new Set(['=', '-', '+', '@', '\t', '\n'])

/**
 * Reads one Firefly III export file, flags missing required columns and removes the formula escape
 * Firefly III puts in front of its cells
 *
 * @param file - The uploaded file
 * @param kind - Which Firefly III export this file is meant to be
 * @param supportedCurrencyCodes - Upper-case codes from the currency list the API served
 */
export async function readFireflyCsvFile(
  file: File,
  kind: FireflyFileKind,
  supportedCurrencyCodes: Set<string>,
): Promise<ImportFileDraft> {
  // A budgets export listing no budgets is an ordinary thing to have, and the flow takes the file as
  // optional, so headings with nothing under them are only refused for the transactions export
  const draft = await readCsvFile(file, supportedCurrencyCodes, {
    requireDataRows: kind === 'transactions',
    unescapeCell: unescapeFireflyCell,
  })
  if (draft.error) return draft

  const headers = new Set(draft.headers)
  const missing = REQUIRED_HEADERS_BY_KIND[kind].filter((header) => !headers.has(header))
  if (missing.length > 0) {
    return { ...draft, error: `Not a Firefly III ${kind} export, missing columns: ${missing.join(', ')}` }
  }

  return draft
}

/**
 * Removes league/csv's formula escape the way its own unescaping does, only where the escape is
 * followed by a character it escapes, so a value that merely starts with an apostrophe keeps it
 */
function unescapeFireflyCell(value: string) {
  if (value[0] !== FORMULA_ESCAPE || !FORMULA_TRIGGERS.has(value[1])) return value
  return value.slice(1)
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
