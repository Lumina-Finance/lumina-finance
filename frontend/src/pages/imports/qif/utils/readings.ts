import type { OfxFile, OfxReadings, OfxReadingScan, OfxTransaction } from '@/pages/imports/ofx/types'
import {
  getQifSplitMismatchReason,
  QIF_AMOUNTS_DIFFER_REASON,
  QIF_SPLIT_UNREADABLE_REASON,
  QIF_TWO_DIGIT_YEAR_REASON,
} from '@/pages/imports/qif/constants'
import {
  readImportAmount,
  readImportDate,
  scanImportAmountFormatChoices,
  scanImportDateFormatChoices,
  type ImportAmountFormat,
} from '@/pages/imports/utils'

// Month, day, then a year of two or four digits. Quicken pads a day or month to two characters with
// a space, as in "6/ 1/1994", and writes the year after an apostrophe where the date is in 2000 or
// later, as in "1/ 2'24"
const NUMERIC_DATE_PATTERN = /^(\d{1,2})\s*\/\s*(\d{1,2})\s*([/'])\s*(\d{2}|\d{4})$/

// A numeric date whose year has two digits after a slash, which names no century
const TWO_DIGIT_YEAR_PATTERN = /^\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{2}$/

const MILLENNIUM = '20'

/**
 * Rewrites a QIF date as the numeric shape the CSV import reads: the two parts, a slash and a
 * four-digit year, with the padding removed
 *
 * An apostrophe before a two-digit year means 2000 or later, which is how the format writes the
 * century. A two-digit year after a slash is left as written, since it names no century and the
 * reader refuses it rather than guess. Any other date, such as one in ISO form, is left as written
 * for the reader to take or refuse
 */
export function normalizeQifDate(text: string) {
  const trimmed = text.trim()
  const match = NUMERIC_DATE_PATTERN.exec(trimmed)
  if (!match) return trimmed

  const [, first, second, separator, year] = match
  if (year.length === 4) return `${first}/${second}/${year}`
  return separator === "'" ? `${first}/${second}/${MILLENNIUM}${year}` : `${first}/${second}/${year}`
}

/**
 * Scans every date and amount of the staged files for the readings that fit them all
 *
 * A reading depends on which texts appear and not on how often, so each text is scanned once. A
 * record with very many split lines is added one line at a time, since spreading them into a call
 * overflows the stack
 */
export function scanQifReadings(files: OfxFile[]): OfxReadingScan {
  const dates = new Set<string>()
  const amounts = new Set<string>()
  for (const { transactions } of files.flatMap((file) => file.statements)) {
    for (const transaction of transactions) {
      dates.add(normalizeQifDate(transaction.postedText))
      amounts.add(transaction.amountText)
      amounts.add(transaction.alternateAmountText ?? '')
      for (const splitText of transaction.splitAmountTexts ?? []) amounts.add(splitText)
    }
  }

  return { date: scanImportDateFormatChoices([...dates]), amount: scanImportAmountFormatChoices([...amounts]) }
}

/**
 * Reads the dates and amounts of a file's transactions under the chosen readings
 *
 * A date or amount no reading is chosen for, or that the chosen one does not read, stays null so the
 * transaction is listed as skipped. Two amounts that disagree, and split amounts that do not add up
 * to the total, skip the transaction with that reason, since no amount is changed to make them fit
 */
export function resolveQifFile(file: OfxFile, readings: OfxReadings): OfxFile {
  return {
    ...file,
    statements: file.statements.map((statement) => ({
      ...statement,
      transactions: statement.transactions.map((transaction) => resolveTransaction(transaction, readings)),
    })),
  }
}

function resolveTransaction(transaction: OfxTransaction, { dateFormat, amountFormat }: OfxReadings): OfxTransaction {
  const date = dateFormat ? readImportDate(normalizeQifDate(transaction.postedText), dateFormat) || null : null
  const total = readAmount(transaction.amountText, amountFormat)
  return {
    ...transaction,
    date,
    amount: total,
    readProblem: findReadProblem(transaction, { date, total, amountFormat }),
  }
}

/** Why the readings of a transaction's own values cannot be trusted, or null when they hold together */
function findReadProblem(
  transaction: OfxTransaction,
  { date, total, amountFormat }: { date: string | null; total: string | null; amountFormat: ImportAmountFormat | null },
) {
  if (date === null && TWO_DIGIT_YEAR_PATTERN.test(transaction.postedText.trim())) return QIF_TWO_DIGIT_YEAR_REASON
  if (total === null) return null

  if (transaction.alternateAmountText) {
    const alternate = readAmount(transaction.alternateAmountText, amountFormat)
    if (alternate === null || !areSumsEqual(total, [alternate])) return QIF_AMOUNTS_DIFFER_REASON
  }

  const splitTexts = transaction.splitAmountTexts ?? []
  if (splitTexts.length === 0) return null

  const splits = splitTexts.map((text) => readAmount(text, amountFormat))
  if (splits.some((split) => split === null)) return QIF_SPLIT_UNREADABLE_REASON

  return areSumsEqual(total, splits as string[]) ? null : getQifSplitMismatchReason(transaction.amountText)
}

/** Reads an amount as plain decimal text with no plus sign, or null when the format does not read it */
function readAmount(text: string, format: ImportAmountFormat | null) {
  const reading = format && text ? readImportAmount(text, format) : null
  return reading ? reading.normalized.replace(/^\+/, '') : null
}

/** Whether the parts add up to the total exactly, compared as decimal digits and never as floats */
function areSumsEqual(total: string, parts: string[]) {
  // A loop and not Math.max(...), since a split list can be long enough to overflow the stack as arguments
  let places = 0
  for (const value of [total, ...parts]) places = Math.max(places, (value.split('.')[1] ?? '').length)

  const scale = (value: string) => {
    const [whole, fraction = ''] = value.split('.')
    const magnitude = BigInt(`${whole.replace('-', '')}${fraction.padEnd(places, '0')}`)
    return whole.startsWith('-') ? -magnitude : magnitude
  }

  return scale(total) === parts.reduce((sum, part) => sum + scale(part), 0n)
}
