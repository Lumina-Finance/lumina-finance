import type { CsvRow, ImportFileDraft } from '@/pages/imports/types'
import { formatBytes } from './common'
import { isSupportedCurrency, isValidAmountValue, isValidDateValue } from './valueParsers'

/**
 * The largest file the importer reads
 *
 * The whole file is decoded into one string and then expanded into an object per row with a key per
 * column, so it costs several times its own size while being read. The size that matters is a
 * whole-history export from another tool, which the Firefly flow brings through this same reader,
 * rather than a single statement
 */
export const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024

/**
 * How many data rows a file may carry
 *
 * This is the bound that governs memory, because the cost is per cell rather than per byte, and it
 * is checked before the records are expanded into row objects
 */
export const MAX_IMPORT_ROWS = 100_000

// What a decoder writes where the bytes did not spell a character it could read
const REPLACEMENT_CHARACTER = '\uFFFD'

// What a byte of text in a two-byte encoding decodes to where the character fits in one byte,
// which is every other byte of an ASCII string written as UTF-16
const NULL_CHARACTER = '\u0000'

// Above this share of the decoded text the bytes are not UTF-8 text at all, which is what a
// spreadsheet or a binary file chosen through the picker's all-files escape hatch looks like. Below
// it the likely cause is a single-byte encoding such as Windows-1252, where only accented characters
// are lost and the rest of the file still reads, so the file stages with a notice rather than being
// refused outright
const MAX_REPLACEMENT_CHARACTER_SHARE = 0.05

// A statement needs at least a date and an amount, so a single column means the delimiter was
// guessed wrongly or the file is not a table at all
const MIN_IMPORT_COLUMNS = 2

// The one parser complaint that means the file cannot be read. A quote left open makes the parser
// stop where it is, so everything after that point lands in a single cell and is lost. Its other
// complaints recover and carry on: the parser steps past a stray quote mid-field and keeps the row,
// and it reports an undetectable delimiter for every single-column file
const FATAL_PARSE_ERROR_CODE = 'MissingQuotes'

const HEADER_ALIASES = new Set([
  'account',
  'accountname',
  'bankaccount',
  'card',
  'cardname',
  'sourceaccount',
  'sourceaccountname',
  'date',
  'datetime',
  'effectivedate',
  'transactiondate',
  'transdate',
  'valuedate',
  'postingdate',
  'posteddate',
  'category',
  'categoryname',
  'transactioncategory',
  'amount',
  'transactionamount',
  'rawamount',
  'signedamount',
  'debit',
  'credit',
  'currency',
  'currencycode',
  'curr',
  'merchant',
  'merchantname',
  'payee',
  'payeename',
  'vendor',
  'vendorname',
  'description',
  'transactiondescription',
  'notes',
  'note',
  'memo',
  'comment',
  'comments',
  'counterparty',
  'detail',
  'details',
  'label',
  'labels',
  'reference',
  'tags',
  'tag',
])

const NO_READABLE_ROWS_ERROR = 'No readable rows detected'
const NO_DATA_ROWS_ERROR = 'This file has a heading row and no transactions under it.'
const SINGLE_COLUMN_ERROR = 'Only one column was found. Check this is a CSV whose fields are separated by a comma, semicolon, tab or pipe.'
const UNREADABLE_TEXT_ERROR = 'This file is not readable as text. Export it as a CSV encoded in UTF-8 and upload it again.'

/**
 * What a staged file carries once its records have been read, or why it cannot be used
 */
interface ParsedCsv {
  headers: string[]
  hasHeaderRow: boolean
  rows: CsvRow[]
  error: string | null
}

/**
 * Reads an uploaded CSV file into a staged import draft, detecting whether the first row is a
 * heading row and recording a readable error on the draft instead of throwing when it cannot be used
 *
 * The file is decoded once and parsed as text rather than streamed. That lets the line endings be
 * settled before parsing, and it keeps a character that spans what would have been a chunk boundary,
 * which the streaming path destroyed. It also holds the whole file in memory, which is why the size
 * is bounded first
 *
 * @param file - The uploaded file
 * @param supportedCurrencyCodes - Upper-case codes from the currency list the API served, used to
 * tell a cell holding a currency from a header word that merely looks like one
 * @param requireDataRows - Whether a file carrying headings with nothing under them is refused. The
 * transaction flow has nothing to import from one, while a budgets export from another tool with no
 * budgets in it is an ordinary thing to have
 */
export async function readCsvFile(
  file: File,
  supportedCurrencyCodes: Set<string>,
  { requireDataRows }: { requireDataRows: boolean },
): Promise<ImportFileDraft> {
  const staged = { id: createFileId(file), name: file.name, size: file.size }
  const refuse = (error: string): ImportFileDraft => ({
    ...staged,
    headers: [],
    hasHeaderRow: false,
    rows: [],
    error,
  })

  if (file.size > MAX_IMPORT_FILE_BYTES) return refuse(getFileTooLargeError(file.size))

  try {
    const text = await file.text()
    const replacementLimit = Math.floor(text.length * MAX_REPLACEMENT_CHARACTER_SHARE)
    const replacementCount = countReplacementCharacters(text, replacementLimit)

    // Text in a two-byte encoding decodes to characters the reader can read, every other one of them
    // a null, rather than to the replacement character, so the count alone would let it through
    if (replacementCount > replacementLimit || text.includes(NULL_CHARACTER)) return refuse(UNREADABLE_TEXT_ERROR)

    const parsed = await parseCsvText(text, supportedCurrencyCodes, requireDataRows)
    if (parsed.error) return refuse(parsed.error)

    const draft: ImportFileDraft = {
      ...staged,
      headers: parsed.headers,
      hasHeaderRow: parsed.hasHeaderRow,
      rows: parsed.rows,
      error: null,
    }
    if (replacementCount > 0) draft.notice = getUnreadableCharacterNotice(replacementCount)

    return draft
  } catch (error) {
    return refuse(getCsvReadError(error))
  }
}

function createFileId(file: File) {
  return `${file.name}-${file.lastModified}-${file.size}-${Math.random().toString(36).slice(2)}`
}

/**
 * Parses the decoded file into records and hands them on to be shaped into headings and rows
 */
async function parseCsvText(
  text: string,
  supportedCurrencyCodes: Set<string>,
  requireDataRows: boolean,
): Promise<ParsedCsv> {
  // Pull the CSV parser on demand so papaparse only ships with the import flow
  const { parse } = await import('papaparse')

  const result = parse<string[]>(normalizeLineEndings(text), {
    header: false,
    skipEmptyLines: 'greedy',
    delimitersToGuess: [',', ';', '\t', '|'],

    // Stated rather than guessed by majority. A file mixing both endings is guessed as the more
    // common one, and every line ending the other way is then read as part of the cell before it,
    // which merges two transactions into a single row and reports nothing
    newline: '\n',
    transform: (value) => String(value ?? '').trim(),
  })

  const malformed = result.errors.find((error) => error.code === FATAL_PARSE_ERROR_CODE)
  if (malformed) return refuseParsedCsv(getMalformedQuoteError(malformed.row))

  const records: string[][] = []
  for (const row of result.data) {
    const record = normalizeRecord(row)
    if (record.some(Boolean)) records.push(record)
  }

  return buildParsedCsv(records, supportedCurrencyCodes, requireDataRows)
}

/**
 * Turns parsed CSV records into the headings and rows a staged file carries, deciding whether the
 * first record holds headings or is itself a transaction, and refusing a shape the import cannot use
 *
 * Kept apart from reading the file so the decisions can be exercised without one
 *
 * @param records - Every non-blank record, in file order
 * @param supportedCurrencyCodes - Upper-case codes from the currency list the API served
 * @param requireDataRows - Whether headings with nothing under them are refused
 */
export function buildParsedCsv(
  records: string[][],
  supportedCurrencyCodes: Set<string>,
  requireDataRows = true,
): ParsedCsv {
  if (records.length === 0) return refuseParsedCsv(NO_READABLE_ROWS_ERROR)

  const hasHeaderRow = detectHeaderRow(records, supportedCurrencyCodes)
  const headers = dedupeHeaders(hasHeaderRow ? records[0] : makeGeneratedHeaders(getMaxColumnCount(records)))
  const dataRecords = hasHeaderRow ? records.slice(1) : records

  if (headers.length < MIN_IMPORT_COLUMNS) return refuseParsedCsv(SINGLE_COLUMN_ERROR)
  if (requireDataRows && dataRecords.length === 0) return refuseParsedCsv(NO_DATA_ROWS_ERROR)
  if (dataRecords.length > MAX_IMPORT_ROWS) return refuseParsedCsv(getTooManyRowsError(dataRecords.length))

  // Only a record wider than the headings loses anything, because a row is built by walking the
  // headings and a value past the last one has nowhere to go. A short record is padded instead,
  // which is what a trailing summary line is, and one of those reaches the preview as an ordinary
  // row to be judged there. Generated headings are sized from the widest record, so this can only
  // bite a file that stated its own
  const raggedIndex = dataRecords.findIndex((record) => record.length > headers.length)
  if (raggedIndex !== -1) {
    return refuseParsedCsv(getRaggedRowError(raggedIndex + 1, dataRecords[raggedIndex].length, headers.length))
  }

  const rows = dataRecords.map((record) => {
    const row: CsvRow = {}
    headers.forEach((header, index) => {
      row[header] = record[index] ?? ''
    })
    return row
  })

  return { headers, hasHeaderRow, rows, error: null }
}

function refuseParsedCsv(error: string): ParsedCsv {
  return { headers: [], hasHeaderRow: false, rows: [], error }
}

/**
 * Rewrites every line ending as a newline, so the parser can be told which one to expect
 *
 * A carriage return inside a quoted value is rewritten too. Telling that one apart would mean
 * parsing the file to decide how to parse it, and a line ending inside a cell has no meaning here
 */
function normalizeLineEndings(text: string) {
  return text.replace(/\r\n?/g, '\n')
}

/**
 * Counts the characters the decoder could not read, stopping once past the point that refuses the
 * file, since the exact count past there changes nothing and the file may be large
 */
function countReplacementCharacters(text: string, limit: number) {
  let count = 0
  let index = text.indexOf(REPLACEMENT_CHARACTER)

  while (index !== -1 && count <= limit) {
    count += 1
    index = text.indexOf(REPLACEMENT_CHARACTER, index + 1)
  }

  return count
}

function normalizeRecord(record: string[]) {
  return (Array.isArray(record) ? record : []).map((cell) => String(cell ?? '').trim())
}

function getCsvReadError(error: unknown) {
  if (error instanceof Error && error.message) return `Unable to parse CSV: ${error.message}`
  return 'Unable to read file'
}

function getFileTooLargeError(size: number) {
  return `This file is ${formatBytes(size)}, and the importer reads files up to ${formatBytes(MAX_IMPORT_FILE_BYTES)}.`
}

function getTooManyRowsError(rowCount: number) {
  return `This file has ${rowCount.toLocaleString()} rows, and the importer reads up to ${MAX_IMPORT_ROWS.toLocaleString()}.`
}

/**
 * Says a quoted value was never closed, which swallows everything after it into one cell
 *
 * The parser counts physical lines, the blank ones it skips included and the heading row among them,
 * so this is the line to open the file at. That is deliberately not the position among data rows a
 * refused row is reported under, since neither count can be turned into the other here
 */
function getMalformedQuoteError(line: number | undefined) {
  const at = line === undefined ? '' : ` on line ${line + 1}`
  return `A quoted value${at} is never closed, so the rest of the file cannot be read.`
}

/**
 * Says a row carries more values than there are columns to put them in
 *
 * @param rowNumber - Position among the file's data rows
 */
function getRaggedRowError(rowNumber: number, valueCount: number, columnCount: number) {
  return `Row ${rowNumber} has ${valueCount} values against ${columnCount} columns, so values would be dropped. An unquoted comma inside a value is the usual cause.`
}

function getUnreadableCharacterNotice(count: number) {
  return `${count} character${count === 1 ? '' : 's'} could not be read`
}

/**
 * Names every column, filling in a blank heading by position and settling a repeated name by
 * counting up until the candidate is free
 *
 * Checking the candidate is free is what stops a file overwriting one of its own columns: with
 * headings `Amount, Amount 2, Amount`, counting occurrences alone gives the third column the second
 * one's name, and a row is a map keyed by name, so the second column's values would be lost while
 * the column count still read three
 */
function dedupeHeaders(rawHeaders: string[]) {
  const taken = new Set<string>()

  return rawHeaders.map((header, index) => {
    const base = header || `Column ${index + 1}`
    let candidate = base
    let occurrence = 1

    while (taken.has(candidate)) {
      occurrence += 1
      candidate = `${base} ${occurrence}`
    }

    taken.add(candidate)
    return candidate
  })
}

function detectHeaderRow(records: string[][], supportedCurrencyCodes: Set<string>) {
  const first = records[0] ?? []
  const nonBlank = first.filter(Boolean)
  if (nonBlank.length === 0) return false

  const headerAliasCount = nonBlank.filter(isKnownHeaderCell).length
  const dataLikeCount = nonBlank.filter((cell) => isDataLikeCell(cell, supportedCurrencyCodes)).length
  if (dataLikeCount > 0 && dataLikeCount >= headerAliasCount) return false
  if (headerAliasCount >= 2) return true
  if (headerAliasCount === nonBlank.length) return true

  const following = records.slice(1, 6)
  if (following.length === 0) return false

  const knownHeaderShiftCount = first.filter((cell, index) => (
    isKnownHeaderCell(cell)
    && following.some((record) => {
      const nextCell = record[index] ?? ''
      return Boolean(nextCell.trim()) && !isKnownHeaderCell(nextCell)
    })
  )).length
  if (headerAliasCount > 0 && knownHeaderShiftCount === headerAliasCount) return true

  const dataShiftCount = first.filter((cell, index) => (
    isHeaderTextCell(cell, supportedCurrencyCodes)
    && following.some((record) => isDataLikeCell(record[index] ?? '', supportedCurrencyCodes))
  )).length

  return dataShiftCount >= 2
}

function getMaxColumnCount(records: string[][]) {
  return Math.max(...records.map((record) => record.length))
}

function makeGeneratedHeaders(count: number) {
  return Array.from({ length: count }, (_, index) => `Column ${index + 1}`)
}

function isKnownHeaderCell(value: string) {
  const normalized = normalizeHeaderCell(value)
  if (!normalized) return false
  const compact = normalized.replace(/\s/g, '')
  return HEADER_ALIASES.has(compact)
}

function isHeaderTextCell(value: string, supportedCurrencyCodes: Set<string>) {
  const trimmed = value.trim()
  return Boolean(trimmed)
    && /[a-z]/i.test(trimmed)
    && !isDataLikeCell(trimmed, supportedCurrencyCodes)
    && trimmed.length <= 48
}

function isDataLikeCell(value: string, supportedCurrencyCodes: Set<string>) {
  return isValidDateValue(value)
    || isValidAmountValue(value)
    || isSupportedCurrency(value, supportedCurrencyCodes)
}

function normalizeHeaderCell(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
