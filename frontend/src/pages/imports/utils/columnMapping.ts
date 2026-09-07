import {
  COLUMN_TARGETS,
  EMPTY_COLUMN_MAP,
  getTooManyDirectionValuesError,
  IMPORT_DATE_FORMAT_LABELS,
  MAX_DIRECTION_COLUMN_VALUES,
} from '@/pages/imports/constants'
import type {
  ColumnMap,
  ColumnTarget,
  ColumnValidationErrors,
  CsvRow,
  ImportAmountDirection,
  ImportAmountProblem,
  ImportFileDraft,
} from '@/pages/imports/types'
import { unique } from './common'
import {
  DEFAULT_IMPORT_AMOUNT_FORMAT,
  type ImportAmountFormat,
  type ImportAmountReading,
  applyImportAmountReadingDirection,
  doesImportAmountReadingSignDisagreeWithDirection,
  isValidMappedImportAmount,
  readImportAmount,
} from './amountFormats'
import {
  foldImportDirectionValue,
  type ImportDateFormat,
  type ImportDateSeparator,
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
    expected: 'amounts in one supported decimal and grouping format',
    requiredValues: true,
    accepts: isValidAmountValue,
  },

  // Neither side requires a value, because a row states its amount on one side and leaves the other
  // blank, which is the whole shape of this arrangement. Which rows a file may leave on neither side,
  // or on both, is judged per row rather than against the column
  amount_out: {
    expected: 'amounts in one supported decimal and grouping format',
    accepts: isValidAmountValue,
  },
  amount_in: {
    expected: 'amounts in one supported decimal and grouping format',
    accepts: isValidAmountValue,
  },

  // No value is wrong on its own here, since the words a file uses are its own. What rules the
  // column out is holding more of them than a direction has. Values are not required either, because
  // a row leaving the cell blank is judged as that row rather than as a fault in the column
  amount_direction: {
    expected: 'one or two words specifying money in or money out, such as DEBIT and CREDIT',
    accepts: acceptsAnyValue,
    refusesColumn: refuseColumnOfTooManyDirections,
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
  formatOptions: ImportColumnFormatOptions = {},
) {
  if (files.length === 0) return { map: EMPTY_COLUMN_MAP, errors: {} }

  const availableHeaders = new Set(files.flatMap((file) => file.headers))
  const errors: ColumnValidationErrors = {}
  const map = { ...EMPTY_COLUMN_MAP }

  for (const target of COLUMN_TARGETS) {
    const header = columnMap[target.id]
    if (!header || !availableHeaders.has(header)) continue

    // Before a format is chosen, mapped amount columns accept any supported reading. Value-only
    // inference remains strict in autoColumnMapping, so this does not turn names into amounts
    const validation = validateColumnValues(files, header, target.id, supportedCurrencyCodes, null, formatOptions)
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
  formatOptions: ImportColumnFormatOptions = {},
) {
  const rule = COLUMN_VALIDATION_RULES[target]
  const numberedValues = getNumberedColumnValues(files, header)
  const values = numberedValues.map((entry) => entry.value)
  // Until a format is settled the date column is only asked whether its values could be dates at
  // all, and it is held to the chosen format from the moment there is one
  const isDateColumnInChosenFormat = target === 'dt' && dateFormat !== null
  const isAmountColumn = target === 'amount' || target === 'amount_out' || target === 'amount_in'
  const expected = isDateColumnInChosenFormat
    ? getDateFormatExpectation(dateFormat, formatOptions.dateSeparator)
    : isAmountColumn
      ? getAmountFormatExpectation(formatOptions.amountFormat)
      : rule.expected
  const accepts = isDateColumnInChosenFormat
    ? (value: string) => Boolean(readImportDate(value, dateFormat, formatOptions.dateSeparator))
    : isAmountColumn
      ? (value: string) => formatOptions.amountFormat
        ? readImportAmount(value, formatOptions.amountFormat) !== null
        : isValidMappedImportAmount(value)
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

export interface ImportColumnFormatOptions {
  dateSeparator?: ImportDateSeparator
  amountFormat?: ImportAmountFormat | null
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
 * Refuses a column mapped as the Direction that holds more words than two directions need
 *
 * Spellings that differ only in capitals or spacing count once, since the panel asks
 * about them once. Blanks are left out, because a row saying nothing is judged as that row
 */
function refuseColumnOfTooManyDirections(values: string[]) {
  const distinct = unique(values.filter(Boolean).map(foldImportDirectionValue))
  if (distinct.length <= MAX_DIRECTION_COLUMN_VALUES) return null

  return getTooManyDirectionValuesError(distinct.length)
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
function getDateFormatExpectation(
  dateFormat: ImportDateFormat,
  separator: ImportDateSeparator = 'automatic',
) {
  const { label, example: defaultExample } = IMPORT_DATE_FORMAT_LABELS[dateFormat]
  const example = dateFormat !== 'written' && separator !== 'automatic'
    ? defaultExample.replace(/[-/]/g, separator)
    : defaultExample

  // The label is title case because it names a dropdown entry, and reads as a proper noun mid
  // sentence unless it is lowered
  return `valid dates in the ${label.toLowerCase()} format, such as ${example}; every row must have a value`
}

/** Describes the amount format a mapped column must use */
function getAmountFormatExpectation(amountFormat: ImportAmountFormat | null | undefined) {
  if (!amountFormat) return 'amounts in one supported decimal and grouping format'

  const decimal = amountFormat.decimalSeparator === '.' ? 'a period' : 'a comma'
  const grouping = getAmountGroupingDescription(amountFormat.groupingSeparator)
  return `amounts using ${decimal} for decimals and ${grouping}`
}

/** Describes one grouping separator without exposing its internal control value */
function getAmountGroupingDescription(grouping: ImportAmountFormat['groupingSeparator']) {
  if (grouping === 'none') return 'no separator between thousands'
  if (grouping === 'space') return 'spaces between thousands'
  if (grouping === '.') return 'periods between thousands'
  if (grouping === ',') return 'commas between thousands'
  return 'apostrophes between thousands'
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
 * Reads a row's amount from whichever arrangement the file is mapped as using
 *
 * A single Amount column is taken as it comes. Where either side is mapped instead, the row states
 * its amount on one side and leaves the other blank or zero, and the side carrying it settles which
 * direction of the row. Where a Direction column is mapped instead, the Amount column carries the
 * size and the word in the direction cell settles the direction
 *
 * @param directionAnswers - What each word in the Direction column means, keyed by the folded value.
 * Empty where no Direction column is mapped, and short of an answer where the user has not given one
 * yet, which the commit refuses before it judges any row
 * @param amountFormat - The separators selected for all mapped amount columns
 * @returns The amount as the payload carries it, and why there is none where the row breaks a rule
 */
export function resolveImportAmount(
  row: CsvRow,
  columnMap: ColumnMap,
  directionAnswers: Record<string, ImportAmountDirection>,
  amountFormat: ImportAmountFormat | null = DEFAULT_IMPORT_AMOUNT_FORMAT,
): {
  amount: string
  amountReading: ImportAmountReading | null
  amountProblem: ImportAmountProblem | null
} {
  if (!columnMap.amount_out && !columnMap.amount_in) {
    const amountCell = getMappedValue(row, columnMap.amount)
    return columnMap.amount_direction
      ? resolveDirectedImportAmount(
        amountCell,
        getMappedValue(row, columnMap.amount_direction),
        directionAnswers,
        amountFormat,
      )
      : resolveSignedImportAmount(amountCell, amountFormat)
  }

  const outCell = getMappedValue(row, columnMap.amount_out)
  const inCell = getMappedValue(row, columnMap.amount_in)
  if (!outCell && !inCell) return { amount: '', amountReading: null, amountProblem: 'neitherFilled' }

  const outReading = outCell && amountFormat ? readImportAmount(outCell, amountFormat) : null
  const inReading = inCell && amountFormat ? readImportAmount(inCell, amountFormat) : null

  // Handed back as it stands, ahead of every rule below, so the row is judged unreadable against the
  // cell the user has to go and fix. Asking which side states an amount first would report a row
  // holding one bad cell and one good one as a row stating two amounts
  if (outCell && outReading === null) return { amount: outCell, amountReading: null, amountProblem: null }
  if (inCell && inReading === null) return { amount: inCell, amountReading: null, amountProblem: null }

  // Asked of each filled cell before the rules below, so a row carrying a contradicting sign on one
  // side and a real amount on the other is reported against the cell to fix rather than as a row
  // stating two amounts
  if (outReading && doesImportAmountReadingSignDisagreeWithDirection(outReading, 'out')) {
    return { amount: '', amountReading: null, amountProblem: 'outSideStatesPlus' }
  }
  if (inReading && doesImportAmountReadingSignDisagreeWithDirection(inReading, 'in')) {
    return { amount: '', amountReading: null, amountProblem: 'inSideStatesMinus' }
  }

  // A zero states no money moved either way, so it never claims its side against the other
  const doesOutState = outReading !== null && !outReading.isZero
  const doesInState = inReading !== null && !inReading.isZero

  if (doesOutState && doesInState) return { amount: '', amountReading: null, amountProblem: 'bothFilled' }

  // Where only one side is mapped every row has to state its amount there, so a zero means this
  // row's money went the way the file has no mapped column for. With both sides mapped the same row
  // is one where no money moved either way, which is a real thing to import
  const isOneSided = !columnMap.amount_out || !columnMap.amount_in
  if (!doesOutState && !doesInState && isOneSided) {
    return { amount: '', amountReading: null, amountProblem: 'sideStatesZero' }
  }

  // Where neither side states an amount, every cell the row did fill is a zero, so whichever side is
  // read gives the same answer
  const direction = doesOutState || !inCell ? 'out' : 'in'
  const reading = direction === 'out' ? outReading : inReading
  if (!reading) return { amount: '', amountReading: null, amountProblem: null }

  const amount = applyImportAmountReadingDirection(reading, direction)

  return {
    amount,
    amountReading: readImportAmount(amount, DEFAULT_IMPORT_AMOUNT_FORMAT),
    amountProblem: null,
  }
}

/** Reads a signed Amount cell without supplying a direction from another column */
function resolveSignedImportAmount(
  amountCell: string,
  amountFormat: ImportAmountFormat | null,
) {
  const reading = amountCell && amountFormat ? readImportAmount(amountCell, amountFormat) : null
  return {
    amount: reading?.normalized ?? amountCell,
    amountReading: reading,
    amountProblem: null,
  }
}

/**
 * Reads a row from a file writing its amount unsigned beside a column of words carrying the direction
 *
 * @param amountCell - The raw Amount cell, which carries the size and may carry an agreeing sign
 * @param directionCell - The raw Direction cell, whose word the user has said the meaning of
 * @param directionAnswers - What each word means, keyed by the folded value
 */
function resolveDirectedImportAmount(
  amountCell: string,
  directionCell: string,
  directionAnswers: Record<string, ImportAmountDirection>,
  amountFormat: ImportAmountFormat | null,
): { amount: string; amountReading: ImportAmountReading | null; amountProblem: ImportAmountProblem | null } {
  // Handed back as it stands, ahead of every rule below, so a row whose amount is blank or cannot be
  // read is judged against that cell rather than against a direction that was never the problem
  const reading = amountCell && amountFormat ? readImportAmount(amountCell, amountFormat) : null
  if (!reading) {
    return { amount: amountCell, amountReading: null, amountProblem: null }
  }

  if (!directionCell) return { amount: '', amountReading: null, amountProblem: 'directionBlank' }

  // A word nobody has answered yet stops the whole commit before any row is judged, so the row is
  // left with no amount rather than given a problem naming a fault that is not its own
  const direction = directionAnswers[foldImportDirectionValue(directionCell)]
  if (!direction) return { amount: '', amountReading: null, amountProblem: null }

  if (doesImportAmountReadingSignDisagreeWithDirection(reading, direction)) {
    return { amount: '', amountReading: null, amountProblem: 'directionSignDisagrees' }
  }

  const amount = applyImportAmountReadingDirection(reading, direction)
  return {
    amount,
    amountReading: readImportAmount(amount, DEFAULT_IMPORT_AMOUNT_FORMAT),
    amountProblem: null,
  }
}

/**
 * Lists the distinct words a column mapped as the Direction holds, in the order the file first
 * states each one, against the folded value the answers are keyed by
 *
 * Spellings differing only in capitals or spacing are one question, and the spelling kept
 * is the first the file used, so the panel shows the user what is actually in their file
 */
export function getImportDirectionValues(files: ImportFileDraft[], header: string) {
  const seen = new Map<string, string>()

  for (const value of getColumnValues(files, header)) {
    if (!value) continue
    const key = foldImportDirectionValue(value)
    if (!seen.has(key)) seen.set(key, value)
  }

  return [...seen].map(([key, label]) => ({ key, label }))
}

/**
 * Answers one word in the Direction column, and the other word with the other direction
 *
 * A column separating money in from money out holds two words that cannot mean the same thing, so
 * answering one settles both. That makes the second click the user used to make either redundant or
 * wrong, and it repairs a stored pair that already agreed rather than leaving it to be corrected
 * word by word
 *
 * Only a column of exactly two words is paired. One word is a file holding money going one way, and
 * it has nothing to be the opposite of
 *
 * @param answers - The answers as they stand, which the result replaces rather than edits
 * @param values - Every distinct word in the column, which is what settles whether there is a pair
 * @param key - The folded word being answered
 * @param direction - What the user chose it means
 */
export function answerImportDirectionValue(
  answers: Record<string, ImportAmountDirection>,
  values: Array<{ key: string }>,
  key: string,
  direction: ImportAmountDirection,
): Record<string, ImportAmountDirection> {
  const next = { ...answers, [key]: direction }
  if (values.length !== MAX_DIRECTION_COLUMN_VALUES) return next

  // The answered word has to be one of the pair, or the other one is whichever came first and
  // answering a word the column no longer holds would rewrite a word it does
  if (!values.some((value) => value.key === key)) return next

  const other = values.find((value) => value.key !== key)
  if (other) next[other.key] = direction === 'out' ? 'in' : 'out'

  return next
}

/**
 * Finds which transaction field a column has been mapped to, returning an empty string when the
 * column is not mapped to anything
 */
export function getTargetForHeader(columnMap: ColumnMap, header: string) {
  // An unmapped field holds an empty string, so an empty header would match the first of them
  if (!header) return ''

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
