import type { CsvPreviewLine, CsvReading, CsvReadingChoices, CsvRow, ImportFileDraft } from '@/pages/imports/types'
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

// The separators the reader tells apart, and the only ones the user can choose in their place
export const IMPORT_DELIMITERS = [',', ';'] as const
export type ImportDelimiter = typeof IMPORT_DELIMITERS[number]

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

// How far down the file the table's header is looked for, past the lines a bank puts above it
const TABLE_START_SEARCH_ROWS = 20

// How many lines from each end of the file the reading preview shows
const READING_PREVIEW_ROWS = 4
const SINGLE_COLUMN_ERROR = 'Only one column was found. Check this is a CSV whose fields are separated by a comma or semicolon.'
export const SINGLE_COLUMN_SEPARATOR_ERROR = 'Only one column was found. Choose the separator your file uses under Separator.'
const UNREADABLE_TEXT_ERROR = 'This file is not readable as text. Export it as a CSV encoded in UTF-8 and upload it again.'

/**
 * What a staged file carries once its records have been read, or why it cannot be used
 */
interface ParsedCsv {
  headers: string[]
  hasHeaderRow: boolean
  rows: CsvRow[]
  error: string | null

  /** Where the table was read from, in a flow that offers reading choices */
  reading?: CsvReading

  /** The separator the general parser read the file with, absent for a tool-specific reader */
  delimiter?: ImportDelimiter
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
 * @param unescapeCell - Undoes the exporting tool's own escaping of a cell. It runs on every cell,
 * headings included, before the cell is trimmed and before the reader weighs delimiters, detects
 * headings or checks anything else, and it sees line endings already rewritten as newlines
 * @param readRecords - Splits the text into records for a tool whose quoting is known and differs
 * from the doubled quotes the general parser expects, receiving the text with line endings already
 * rewritten as newlines. It returns null for text the tool did not write as it stands, such as its
 * export saved again by a spreadsheet, which the general parser then reads with its delimiter guessing
 * @param delimiter - The separator the user chose, which the general parser reads with in place of guessing
 * @param offersReadingChoices - Whether the flow offers the Separator choice, Header row and Skip last
 * rows, which the reader then finds the table's start for and points its refusals to
 * @param headerRow - The header row the user chose, counted from 1, found by the reader when left out
 * @param skipLastRows - How many lines the user chose to leave out from the end of the file
 */
export async function readCsvFile(
  file: File,
  supportedCurrencyCodes: Set<string>,
  {
    requireDataRows,
    unescapeCell = (value) => value,
    readRecords,
    delimiter,
    offersReadingChoices = false,
    headerRow,
    skipLastRows,
  }: {
    requireDataRows: boolean
    unescapeCell?: (value: string) => string
    readRecords?: (text: string) => string[][] | null
    delimiter?: ImportDelimiter
    offersReadingChoices?: boolean
    headerRow?: number
    skipLastRows?: number
  },
): Promise<ImportFileDraft> {
  const staged = { id: createFileId(file), name: file.name, size: file.size }
  const refuse = (error: string, read: Pick<ImportFileDraft, 'delimiter' | 'reading'> = {}): ImportFileDraft => ({
    ...staged,
    headers: [],
    hasHeaderRow: false,
    rows: [],
    error,
    ...read,
  })

  if (file.size > MAX_IMPORT_FILE_BYTES) return refuse(getFileTooLargeError(file.size))

  try {
    const text = await file.text()
    // One unreadable character is always allowed, since the share alone rounds down to none at all
    // below twenty characters and would refuse a short file outright for a single accented name
    const replacementLimit = Math.max(1, Math.floor(text.length * MAX_REPLACEMENT_CHARACTER_SHARE))
    const replacementCount = countReplacementCharacters(text, replacementLimit)

    // Text in a two-byte encoding decodes to characters the reader can read, every other one of them
    // a null, rather than to the replacement character, so the count alone would let it through
    if (replacementCount > replacementLimit || text.includes(NULL_CHARACTER)) return refuse(UNREADABLE_TEXT_ERROR)

    const parsed = parseKnownCsvText(text, supportedCurrencyCodes, requireDataRows, unescapeCell, readRecords)
      ?? await parseCsvText(text, supportedCurrencyCodes, requireDataRows, unescapeCell, delimiter, offersReadingChoices ? { headerRow, skipLastRows } : undefined)
    const read = { ...(parsed.delimiter && { delimiter: parsed.delimiter }), ...(parsed.reading && { reading: parsed.reading }) }
    if (parsed.error) {
      const error = offersReadingChoices && parsed.error === SINGLE_COLUMN_ERROR ? SINGLE_COLUMN_SEPARATOR_ERROR : parsed.error
      return refuse(error, read)
    }

    const draft: ImportFileDraft = {
      ...staged,
      headers: parsed.headers,
      hasHeaderRow: parsed.hasHeaderRow,
      rows: parsed.rows,
      error: null,
      ...read,
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
  unescapeCell: (value: string) => string,
  chosenDelimiter: ImportDelimiter | undefined,
  choices: CsvReadingChoices | undefined,
): Promise<ParsedCsv> {
  // Pull the CSV parser on demand so papaparse only ships with the import flow
  const { parse } = await import('papaparse')

  const transform = (value: unknown) => unescapeCell(String(value ?? '')).trim()

  const normalizedText = normalizeLineEndings(text)
  let result = parse<string[]>(normalizedText, {
    header: false,
    skipEmptyLines: 'greedy',
    ...(chosenDelimiter ? { delimiter: chosenDelimiter } : { delimitersToGuess: [...IMPORT_DELIMITERS] }),

    // Stated rather than guessed by majority. A file mixing both endings is guessed as the more
    // common one, and every line ending the other way is then read as part of the cell before it,
    // which merges two transactions into a single row and reports nothing
    newline: '\n',
    transform,
  })

  // A headerless file with decimal-comma amounts can give the guesser the same number of commas and
  // field delimiters on every row. If it chooses comma, the real delimiter remains embedded in a
  // cell and every amount loses its fractional digits. Retry only delimiters still visible in the
  // guessed cells, retaining Papa's choice unless a stable reading recovers stronger strict evidence.
  // A separator the user chose is read as it is
  for (const delimiter of chosenDelimiter ? [] : IMPORT_DELIMITERS) {
    if (delimiter === result.meta.delimiter) continue
    if (!result.data.some((row) => row.some((cell) => cell.includes(delimiter)))) continue

    const candidate = parse<string[]>(normalizedText, {
      delimiter,
      header: false,
      skipEmptyLines: 'greedy',
      newline: '\n',
      transform,
    })

    const isMalformed = candidate.errors.some((error) => error.code === FATAL_PARSE_ERROR_CODE)
    if (!isMalformed && shouldPreferDelimiterResult(result.data, candidate.data, supportedCurrencyCodes)) {
      result = candidate
    }
  }

  // Papa reads a file it found no separator in with a comma, so every reading names one of these
  const delimiter = IMPORT_DELIMITERS.find((candidate) => candidate === result.meta.delimiter) ?? IMPORT_DELIMITERS[0]
  const malformed = result.errors.find((error) => error.code === FATAL_PARSE_ERROR_CODE)
  if (malformed) return { ...refuseParsedCsv(getMalformedQuoteError(malformed.row)), delimiter }

  const records: string[][] = []
  for (const row of result.data) {
    const record = normalizeRecord(row)
    if (record.some(Boolean)) records.push(record)
  }

  return { ...buildParsedCsv(records, supportedCurrencyCodes, requireDataRows, choices), delimiter }
}

/**
 * Reads the decoded file with a tool-specific record reader and hands the records on to be shaped
 * into headings and rows, the way the general parser's records are, or returns null when there is no
 * such reader or the text is not in its tool's quoting
 */
function parseKnownCsvText(
  text: string,
  supportedCurrencyCodes: Set<string>,
  requireDataRows: boolean,
  unescapeCell: (value: string) => string,
  readRecords: ((text: string) => string[][] | null) | undefined,
): ParsedCsv | null {
  const read = readRecords?.(normalizeLineEndings(text))
  if (!read) return null

  const records: string[][] = []
  for (const row of read) {
    const record = row.map((value) => unescapeCell(value).trim())
    if (record.some(Boolean)) records.push(record)
  }

  return buildParsedCsv(records, supportedCurrencyCodes, requireDataRows)
}

/** Reports whether an explicit delimiter reading is demonstrably stronger than Papa's guess */
function shouldPreferDelimiterResult(
  currentRows: string[][],
  candidateRows: string[][],
  supportedCurrencyCodes: Set<string>,
) {
  const records = candidateRows.map(normalizeRecord).filter((row) => row.some(Boolean))
  const widths = new Set(records.map((row) => row.length))
  if (records.length === 0 || widths.size !== 1 || records[0].length < MIN_IMPORT_COLUMNS) return false

  const current = getDelimiterEvidence(currentRows, supportedCurrencyCodes)
  const candidate = getDelimiterEvidence(records, supportedCurrencyCodes)
  if (current.dates > 0) return false
  if (candidate.total < current.total) return false
  return candidate.dates > current.dates
    || (candidate.dates === current.dates && candidate.headers > current.headers)
}

/** Counts strict structural and general cell evidence for one candidate delimiter */
function getDelimiterEvidence(rows: string[][], supportedCurrencyCodes: Set<string>) {
  let dates = 0
  let headers = 0
  let total = 0

  for (const row of rows.slice(0, 20)) {
    for (const cell of row) {
      const isDate = isValidDateValue(cell)
      const isHeader = isKnownHeaderCell(cell)
      if (isDate) dates += 1
      if (isHeader) headers += 1
      if (isDate || isHeader || isValidAmountValue(cell) || isSupportedCurrency(cell, supportedCurrencyCodes)) {
        total += 1
      }
    }
  }

  return { dates, headers, total }
}

/**
 * Turns parsed CSV records into the headings and rows a staged file carries, deciding whether the
 * first record holds headings or is itself a transaction, and refusing a shape the import cannot use
 *
 * Kept apart from reading the file so the decisions can be exercised without one
 *
 * Where the flow offers reading choices, lines above the table and the last lines the user chose are
 * left out first: the table starts at the header row the user gave, or at the one found by
 * `findTableStart`, and the rows the user asked to skip are dropped from the end
 *
 * @param records - Every non-blank record, in file order
 * @param supportedCurrencyCodes - Upper-case codes from the currency list the API served
 * @param requireDataRows - Whether headings with nothing under them are refused
 * @param choices - The flow's reading choices, absent where it offers none and the table starts on
 * the first record and runs to the last
 */
export function buildParsedCsv(
  records: string[][],
  supportedCurrencyCodes: Set<string>,
  requireDataRows = true,
  choices?: CsvReadingChoices,
): ParsedCsv {
  if (records.length === 0) return refuseParsedCsv(NO_READABLE_ROWS_ERROR)

  // The field never offers skipping every line, and a header row below the lines kept is a choice
  // made before Skip last rows was raised, so both are held to what the file has and shown as used
  const skipLastRows = Math.min(choices?.skipLastRows ?? 0, records.length - 1)
  const end = records.length - skipLastRows
  const isHeaderChosen = choices?.headerRow !== undefined
  const start = isHeaderChosen
    ? Math.min(choices.headerRow! - 1, end - 1)
    : choices ? findTableStart(records.slice(0, end)) : 0

  const table = records.slice(start, end)
  const hasHeaderRow = isHeaderChosen || detectHeaderRow(table, supportedCurrencyCodes)
  const reading: CsvReading | undefined = choices && {
    headerRow: hasHeaderRow ? start + 1 : null,
    skipLastRows,
    preview: buildReadingPreview(records, start, end),
  }
  const refuse = (error: string) => ({ ...refuseParsedCsv(error), reading })

  const headers = dedupeHeaders(hasHeaderRow ? table[0] : makeGeneratedHeaders(getMaxColumnCount(table)))
  const dataRecords = hasHeaderRow ? table.slice(1) : table

  if (headers.length < MIN_IMPORT_COLUMNS) return refuse(SINGLE_COLUMN_ERROR)
  if (requireDataRows && dataRecords.length === 0) return refuse(NO_DATA_ROWS_ERROR)
  if (dataRecords.length > MAX_IMPORT_ROWS) return refuse(getTooManyRowsError(dataRecords.length))

  // Only a record wider than the headings loses anything, because a row is built by walking the
  // headings and a value past the last one has nowhere to go. A short record is padded instead,
  // which is what a trailing summary line is, and one of those reaches the preview as an ordinary
  // row to be judged there. Generated headings are sized from the widest record, so this can only
  // bite a file that stated its own. Where rows can be skipped, the line is named by its place in
  // the file, as the header row is, with the count that would skip it and everything after it
  const raggedIndex = dataRecords.findIndex((record) => record.length > headers.length)
  if (raggedIndex !== -1) {
    const valueCount = dataRecords[raggedIndex].length
    if (!choices) return refuse(getRaggedRowError(raggedIndex + 1, valueCount, headers.length))

    const fileIndex = start + (hasHeaderRow ? 1 : 0) + raggedIndex
    const suggestedSkipLastRows = records.length - fileIndex
    return {
      ...refuseParsedCsv(getRaggedFooterError(fileIndex + 1, valueCount, headers.length, suggestedSkipLastRows)),
      reading: reading && { ...reading, suggestedSkipLastRows },
    }
  }

  const rows = dataRecords.map((record) => {
    const row: CsvRow = {}
    headers.forEach((header, index) => {
      row[header] = record[index] ?? ''
    })
    return row
  })

  return { headers, hasHeaderRow, rows, error: null, reading }
}

function refuseParsedCsv(error: string): ParsedCsv {
  return { headers: [], hasHeaderRow: false, rows: [], error }
}

/**
 * Finds where the table starts below any lines a bank puts above it, such as account details
 *
 * The table is taken to be as wide as most of the file's records, the widest such width where two
 * are as common, and to start at the first record of that width near the top. A file where none
 * of the first records is that wide starts on its first record, as it did before rows could be skipped
 *
 * A record of known headings just above that first record is the header instead, which is how a
 * header narrower than its rows, such as rows that each end with a separator, is still read from it
 */
export function findTableStart(records: string[][]) {
  const widthCounts = new Map<number, number>()
  for (const record of records) widthCounts.set(record.length, (widthCounts.get(record.length) ?? 0) + 1)

  let tableWidth = 0
  let tableWidthCount = 0
  for (const [width, count] of widthCounts) {
    if (count > tableWidthCount || (count === tableWidthCount && width > tableWidth)) {
      tableWidth = width
      tableWidthCount = count
    }
  }

  const start = records.slice(0, TABLE_START_SEARCH_ROWS).findIndex((record) => record.length === tableWidth)
  if (start <= 0) return 0
  const isHeadingRecord = (record: string[]) => record.filter(isKnownHeaderCell).length >= 2
  return isHeadingRecord(records[start - 1]) && !isHeadingRecord(records[start]) ? start - 1 : start
}

/**
 * The first and last few records of the file, each marked with whether it is left out because it
 * sits above the header row or among the last rows skipped
 */
function buildReadingPreview(records: string[][], start: number, end: number): CsvPreviewLine[] {
  const indexes = new Set<number>()
  for (let index = 0; index < Math.min(READING_PREVIEW_ROWS, records.length); index += 1) indexes.add(index)
  for (let index = Math.max(0, records.length - READING_PREVIEW_ROWS); index < records.length; index += 1) indexes.add(index)

  return [...indexes].map((index) => ({
    rowNumber: index + 1,
    cells: records[index],
    isSkipped: index < start || index >= end,
  }))
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

function getRaggedFooterError(rowNumber: number, valueCount: number, columnCount: number, rowsToEnd: number) {
  return `Row ${rowNumber} has ${valueCount} values against ${columnCount} columns, so values would be dropped. If it starts a summary at the end of the file, set Skip last rows to ${rowsToEnd}. Otherwise an unquoted comma inside a value is the usual cause.`
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
