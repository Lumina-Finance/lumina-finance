import type { CsvRow, ImportFileDraft } from '../types'
import { isSupportedCurrency, isValidAmountValue, isValidDateValue } from './valueParsers'

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

/**
 * Parses an uploaded CSV file into a staged import draft, detecting whether the first row is a
 * header row and recording a readable error on the draft instead of throwing when parsing fails
 */
export async function readCsvFile(file: File): Promise<ImportFileDraft> {
  const id = createFileId(file)

  try {
    const { headers, hasHeaderRow, rows } = await parseCsvFile(file)
    return {
      id,
      name: file.name,
      size: file.size,
      headers,
      hasHeaderRow,
      rows,
      error: headers.length === 0 ? 'No readable rows detected' : null,
    }
  } catch (error) {
    return {
      id,
      name: file.name,
      size: file.size,
      headers: [],
      hasHeaderRow: false,
      rows: [],
      error: getCsvReadError(error),
    }
  }
}

function createFileId(file: File) {
  return `${file.name}-${file.lastModified}-${file.size}-${Math.random().toString(36).slice(2)}`
}

async function parseCsvFile(file: File): Promise<{ headers: string[]; hasHeaderRow: boolean; rows: CsvRow[] }> {
  // Pull the CSV parser on demand so papaparse only ships with the import flow
  const { parse } = await import('papaparse')

  return new Promise((resolve, reject) => {
    const records: string[][] = []

    parse<string[]>(file, {
      header: false,
      skipEmptyLines: 'greedy',
      delimitersToGuess: [',', ';', '\t', '|'],
      transform: (value) => String(value ?? '').trim(),
      chunk: (result) => {
        for (const row of result.data) {
          const record = normalizeRecord(row)
          if (record.some(Boolean)) records.push(record)
        }
      },
      complete: () => {
        resolve(buildParsedCsv(records))
      },
      error: (error) => {
        reject(error)
      },
    })
  })
}

function buildParsedCsv(records: string[][]) {
  if (records.length === 0) return { headers: [], hasHeaderRow: false, rows: [] }

  const hasHeaderRow = detectHeaderRow(records)
  const headers = dedupeHeaders(hasHeaderRow ? records[0] : makeGeneratedHeaders(getMaxColumnCount(records)))
  const rows = (hasHeaderRow ? records.slice(1) : records).map((record) => {
    const row: CsvRow = {}
    headers.forEach((header, index) => {
      row[header] = record[index] ?? ''
    })
    return row
  })

  return { headers, hasHeaderRow, rows }
}

function normalizeRecord(record: string[]) {
  return (Array.isArray(record) ? record : []).map((cell) => String(cell ?? '').trim())
}

function getCsvReadError(error: unknown) {
  if (error instanceof Error && error.message) return `Unable to parse CSV: ${error.message}`
  return 'Unable to read file'
}

function dedupeHeaders(rawHeaders: string[]) {
  const seen = new Map<string, number>()

  return rawHeaders.map((header, index) => {
    const base = header || `Column ${index + 1}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base} ${count + 1}`
  })
}

function detectHeaderRow(records: string[][]) {
  const first = records[0] ?? []
  const nonBlank = first.filter(Boolean)
  if (nonBlank.length === 0) return false

  const headerAliasCount = nonBlank.filter(isKnownHeaderCell).length
  const dataLikeCount = nonBlank.filter(isDataLikeCell).length
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
    isHeaderTextCell(cell) && following.some((record) => isDataLikeCell(record[index] ?? ''))
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

function isHeaderTextCell(value: string) {
  const trimmed = value.trim()
  return Boolean(trimmed)
    && /[a-z]/i.test(trimmed)
    && !isDataLikeCell(trimmed)
    && trimmed.length <= 48
}

function isDataLikeCell(value: string) {
  return isValidDateValue(value) || isValidAmountValue(value) || isSupportedCurrency(value)
}

function normalizeHeaderCell(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
