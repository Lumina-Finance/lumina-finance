import { COLUMN_TARGETS, EMPTY_COLUMN_MAP, IMPORT_DATE_FORMAT_LABELS } from '@/pages/imports/constants'
import type { ColumnMap, ColumnTarget, ColumnValidationErrors, CsvRow, ImportFileDraft } from '@/pages/imports/types'
import { unique } from './common'
import {
  type ImportDateFormat,
  isSupportedCurrency,
  isValidAmountValue,
  isValidDateValue,
  readImportDate,
  truncateValue,
} from './valueParsers'

const COLUMN_VALIDATION_RULES: Record<ColumnTarget, {
  expected: string
  requiredValues?: boolean
  accepts: (value: string, supportedCurrencyCodes: Set<string>) => boolean

  /**
   * Refuses the column on what all of its values are together, where no single value is wrong
   *
   * Kept apart from `accepts` because the two say different things: one points at the value that
   * broke the column, and this one describes a shape the whole column has
   */
  refusesColumn?: (values: string[]) => string | null
}> = {
  account_id: {
    expected: 'account names or source account labels; every row must have a value',
    requiredValues: true,
    accepts: acceptsAnyValue,
    refusesColumn: refuseColumnOfOnlyNumbersOrDates,
  },
  dt: {
    expected: 'valid dates in one format across the whole file; every row must have a value',
    requiredValues: true,
    accepts: isValidDateValue,
  },
  category_id: {
    expected: 'category names; every row must have a value',
    requiredValues: true,
    accepts: acceptsAnyValue,
    refusesColumn: refuseColumnOfOnlyNumbersOrDates,
  },
  amount: {
    expected: 'a raw signed number such as -12.34 or 1,234.56; every row must have a value',
    requiredValues: true,
    accepts: isValidAmountValue,
  },
  currency: {
    expected: 'ISO currency codes this app supports, such as CAD or USD',
    accepts: isSupportedCurrency,
  },

  // The three below take a value as it comes. A merchant, a note or a tag can legitimately be
  // written as a number, so there is nothing here worth refusing, and the wording says only what
  // the field is for rather than claiming a check that does not run
  merchant_id: {
    expected: 'merchant or payee names',
    accepts: acceptsAnyValue,
  },
  notes: {
    expected: 'transaction notes',
    accepts: acceptsAnyValue,
  },
  tag_ids: {
    expected: 'tag names separated by commas, semicolons, or pipes',
    accepts: acceptsAnyValue,
  },
  counterparty_account_id: {
    // Only the shape of a value is checked here. Whether a row may state one at all depends on the
    // category and account mappings chosen later, and is reported against the row itself
    expected: 'the account name a transfer moved money to or from',
    accepts: acceptsAnyValue,
    refusesColumn: refuseColumnOfOnlyNumbersOrDates,
  },
}

/**
 * Rebuilds a column map to keep only mappings whose header still exists in the uploaded files, and
 * records a validation error for any mapped column whose values do not match what the target field
 * expects
 */
export function validateColumnMap(
  columnMap: ColumnMap,
  files: ImportFileDraft[],
  supportedCurrencyCodes: Set<string>,
) {
  if (files.length === 0) return { map: EMPTY_COLUMN_MAP, errors: {} }

  const availableHeaders = new Set(files.flatMap((file) => file.headers))
  const errors: ColumnValidationErrors = {}
  const map = { ...EMPTY_COLUMN_MAP }

  for (const target of COLUMN_TARGETS) {
    const header = columnMap[target.id]
    if (!header || !availableHeaders.has(header)) continue

    // No format is passed, because this runs while inferring which column is which, before anyone
    // has chosen one. The hook holds the date column to the chosen format on its own path
    const validation = validateColumnValues(files, header, target.id, supportedCurrencyCodes)
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
  supportedCurrencyCodes: Set<string>,
  dateFormat: ImportDateFormat | null = null,
) {
  const rule = COLUMN_VALIDATION_RULES[target]
  const numberedValues = getNumberedColumnValues(files, header)
  const values = numberedValues.map((entry) => entry.value)
  // Until a format is settled the date column is only asked whether its values could be dates at
  // all, and it is held to the chosen format from the moment there is one
  const isDateColumnInChosenFormat = target === 'dt' && dateFormat !== null
  const expected = isDateColumnInChosenFormat ? getDateFormatExpectation(dateFormat) : rule.expected
  const accepts = isDateColumnInChosenFormat
    ? (value: string) => Boolean(readImportDate(value, dateFormat))
    : (value: string) => rule.accepts(value, supportedCurrencyCodes)

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
      message: `Expected ${expected}. ${blankCount} row${blankCount === 1 ? ' is' : 's are'} blank.`,
    }
  }

  const columnRefusal = rule.refusesColumn?.(values)
  if (columnRefusal) {
    return {
      valid: false,
      message: `Expected ${expected}. ${columnRefusal}`,
    }
  }

  const invalid = numberedValues.find((entry) => entry.value && !accepts(entry.value))
  if (invalid) {
    return {
      valid: false,
      message: `Expected ${expected}. Row ${invalid.rowNumber} has "${truncateValue(invalid.value)}", which ${getMismatchReason(target)}.`,
    }
  }

  return { valid: true, message: '' }
}

/**
 * Refuses a column of names whose every filled value reads as an amount or a date
 *
 * Pointing a name field at a column of money is a mapping mistake rather than an intent: the Amount
 * column mapped to Category used to import, creating categories called -12.34. Judging the column as
 * a whole rather than each value is what lets an account known by a number sit among named ones,
 * since one number among names says nothing about what the column holds
 */
function refuseColumnOfOnlyNumbersOrDates(values: string[]) {
  const filled = values.filter(Boolean)
  if (filled.length === 0) return null
  if (!filled.every((value) => isMoneyShapedValue(value) || isValidDateValue(value))) return null

  return 'Every value in this column reads as an amount or a date.'
}

/**
 * Reports whether a value is written the way money is written, rather than merely being digits
 *
 * A run of bare digits is an identifier as often as it is an amount, and an account, a counterparty
 * or a category can legitimately be known by a number. What money carries and an identifier does not
 * is a sign, a decimal point, or commas grouping the thousands, so that is what rules a column out
 */
function isMoneyShapedValue(value: string) {
  return isValidAmountValue(value) && /[-+.,]/.test(value.trim())
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
  return getNumberedColumnValues(files, header).map((entry) => entry.value)
}

/**
 * Reads every row's value for one header, each against the row it came from
 *
 * The row number is the position among that file's data rows, which is what a refused row is
 * reported under elsewhere, so the two agree. It is not the line in the file, because parsing drops
 * blank lines and folds a quoted value carrying a newline into one row
 *
 * Numbering restarts per file, so it only reads as one number because the transaction flow stages a
 * single file. Staging several would need the file named alongside it
 */
function getNumberedColumnValues(files: ImportFileDraft[], header: string) {
  return files.flatMap((file) => {
    if (!file.headers.includes(header)) return []
    return file.rows.map((row, index) => ({ value: row[header]?.trim() ?? '', rowNumber: index + 1 }))
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

/**
 * Takes a value as it comes
 *
 * Used by the fields where no single value can be wrong. Three of them are still refused as a whole
 * column by `refusesColumn`, which is where the judgement about those actually lives
 */
function acceptsAnyValue() {
  return true
}
