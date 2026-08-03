import { COLUMN_TARGETS, EMPTY_COLUMN_MAP, IMPORT_DATE_FORMAT_LABELS } from '@/pages/imports/constants'
import type { ColumnMap, ColumnTarget, ColumnValidationErrors, CsvRow, ImportFileDraft } from '@/pages/imports/types'
import { unique } from './common'
import {
  type ImportDateFormat,
  isValidAmountValue,
  isValidCurrencyCode,
  isValidDateValue,
  readImportDate,
  truncateValue,
} from './valueParsers'

const COLUMN_VALIDATION_RULES: Record<ColumnTarget, {
  expected: string
  requiredValues?: boolean
  accepts: (value: string) => boolean
}> = {
  account_id: {
    expected: 'account names or source account labels; every row must have a value',
    requiredValues: true,
    accepts: isPlainTextValue,
  },
  dt: {
    expected: 'valid dates in one format across the whole file; every row must have a value',
    requiredValues: true,
    accepts: isValidDateValue,
  },
  category_id: {
    expected: 'category names as plain text; every row must have a value',
    requiredValues: true,
    accepts: isPlainTextValue,
  },
  amount: {
    expected: 'a raw signed number such as -12.34 or 1,234.56; every row must have a value',
    requiredValues: true,
    accepts: isValidAmountValue,
  },
  currency: {
    expected: '3-letter ISO currency codes such as CAD or USD',
    accepts: isValidCurrencyCode,
  },
  merchant_id: {
    expected: 'merchant or payee names as plain text',
    accepts: isPlainTextValue,
  },
  notes: {
    expected: 'plain text notes',
    accepts: isPlainTextValue,
  },
  tag_ids: {
    expected: 'tag names separated by commas, semicolons, or pipes',
    accepts: isPlainTextValue,
  },
  counterparty_account_id: {
    expected: 'the account name a transfer moved money to or from, blank on every other row',
    accepts: isPlainTextValue,
  },
}

/**
 * Rebuilds a column map to keep only mappings whose header still exists in the uploaded files, and
 * records a validation error for any mapped column whose values do not match what the target field
 * expects
 */
export function validateColumnMap(columnMap: ColumnMap, files: ImportFileDraft[]) {
  if (files.length === 0) return { map: EMPTY_COLUMN_MAP, errors: {} }

  const availableHeaders = new Set(files.flatMap((file) => file.headers))
  const errors: ColumnValidationErrors = {}
  const map = { ...EMPTY_COLUMN_MAP }

  for (const target of COLUMN_TARGETS) {
    const header = columnMap[target.id]
    if (!header || !availableHeaders.has(header)) continue

    // No format is passed, because this runs while inferring which column is which, before anyone
    // has chosen one. The hook holds the date column to the chosen format on its own path
    const validation = validateColumnValues(files, header, target.id)
    map[target.id] = header
    if (!validation.valid) errors[header] = validation.message
  }

  return { map, errors }
}

/**
 * Checks a column's values against the target field's expected format, returning why the column
 * failed when it has no readable values, has blanks in a field where every row is required, or
 * contains a value that does not match what the field accepts
 */
export function validateColumnValues(
  files: ImportFileDraft[],
  header: string,
  target: ColumnTarget,
  dateFormat: ImportDateFormat | null = null,
) {
  const rule = COLUMN_VALIDATION_RULES[target]
  const values = getColumnValues(files, header)
  // Until a format is settled the date column is only asked whether its values could be dates at
  // all, and it is held to the chosen format from the moment there is one
  const isDateColumnInChosenFormat = target === 'dt' && dateFormat !== null
  const expected = isDateColumnInChosenFormat ? getDateFormatExpectation(dateFormat) : rule.expected
  const accepts = isDateColumnInChosenFormat
    ? (value: string) => Boolean(readImportDate(value, dateFormat))
    : rule.accepts

  if (values.length === 0) {
    return {
      valid: false,
      message: `Expected ${expected}. This column has no readable values.`,
    }
  }

  const blankCount = values.filter((value) => value.length === 0).length
  if (rule.requiredValues && blankCount > 0) {
    return {
      valid: false,
      message: `Expected ${expected}. ${blankCount} row${blankCount === 1 ? '' : 's'} are blank.`,
    }
  }

  const invalidValue = values.filter(Boolean).find((value) => !accepts(value))
  if (invalidValue) {
    return {
      valid: false,
      message: `Expected ${expected}. "${truncateValue(invalidValue)}" ${getMismatchReason(target)}.`,
    }
  }

  return { valid: true, message: '' }
}

/**
 * Names the chosen date format and an example of it, so a row that broke the column says what the
 * rest of the file looks like rather than only that it failed
 */
function getDateFormatExpectation(dateFormat: ImportDateFormat) {
  const { label, example } = IMPORT_DATE_FORMAT_LABELS[dateFormat]

  // The label is title case because it names a dropdown entry, and reads as a proper noun mid
  // sentence unless it is lowered
  return `valid dates in the ${label.toLowerCase()} format, such as ${example}; every row must have a value`
}

/**
 * Says how a value failed its column
 *
 * A date can fail for three reasons the reader does not distinguish: a shape it does not fit, a day
 * the calendar does not have, and a year outside the accepted span. Naming the value without
 * claiming which of the three it was keeps the message from sending the user to the wrong fix
 */
function getMismatchReason(target: ColumnTarget) {
  return target === 'dt' ? 'is not a valid date' : 'does not match'
}

/**
 * Reads every row's value for one header across all uploaded files, blanks included
 */
export function getColumnValues(files: ImportFileDraft[], header: string) {
  return files.flatMap((file) => {
    if (!file.headers.includes(header)) return []
    return file.rows.map((row) => row[header]?.trim() ?? '')
  })
}

/**
 * Reads a row's trimmed value for the given header, or an empty string when the header is unmapped
 */
export function getMappedValue(row: CsvRow, header: string) {
  return header ? row[header]?.trim() ?? '' : ''
}

/**
 * Finds which transaction field a column has been mapped to, returning an empty string when the
 * column is not mapped to anything
 */
export function getTargetForHeader(columnMap: ColumnMap, header: string) {
  return COLUMN_TARGETS.find((target) => columnMap[target.id] === header)?.id ?? ''
}

/**
 * Picks up to three distinct non-empty values from a column, used to show the user what a column
 * actually holds while they decide what to map it to
 */
export function getColumnSamples(files: ImportFileDraft[], header: string) {
  return unique(
    getColumnValues(files, header).filter(Boolean),
  ).slice(0, 3)
}

function isPlainTextValue() {
  return true
}
