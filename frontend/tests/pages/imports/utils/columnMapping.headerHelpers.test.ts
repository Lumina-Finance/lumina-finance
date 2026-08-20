/**
 * Tests the two small readers the mapping step and its samples rely on: which target a header is
 * currently mapped to, and what a column's own values look like before anyone maps it to anything
 */
import { describe, expect, it } from 'vitest'
import { EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import type { ColumnMap, CsvRow, ImportFileDraft } from '@/pages/imports/types'
import { getColumnSamples, getTargetForHeader } from '@/pages/imports/utils'

/**
 * Creates a one-file draft from the given headers and rows
 */
function createFile(headers: string[], rows: CsvRow[]): ImportFileDraft {
  return {
    id: 'file-1',
    name: 'Chequing.csv',
    size: 1024,
    headers,
    hasHeaderRow: true,
    rows,
    error: null,
  }
}

/**
 * Builds a one-column file from the values it holds
 */
function createColumn(header: string, values: string[]) {
  return [createFile([header], values.map((value) => ({ [header]: value })))]
}

describe('finding which target a header is mapped to', () => {
  // Every unmapped field holds '', which used to make an empty header match account_id, the first
  // target the loop reached
  it('returns nothing for an empty header', () => {
    expect(getTargetForHeader(EMPTY_COLUMN_MAP, '')).toBe('')
  })

  it('picks the earlier target when two point at the same header', () => {
    const map: ColumnMap = { ...EMPTY_COLUMN_MAP, merchant_id: 'Payee', notes: 'Payee' }

    expect(getTargetForHeader(map, 'Payee')).toBe('merchant_id')
  })

  it('is case sensitive', () => {
    const map: ColumnMap = { ...EMPTY_COLUMN_MAP, dt: 'Date' }

    expect(getTargetForHeader(map, 'date')).toBe('')
  })
})

describe('sampling a column\'s own values', () => {
  // A regression that caps before it dedupes would return only ['Acme', 'Bee']
  it('dedupes before capping at three', () => {
    const files = createColumn('Merchant', ['Acme', 'Acme', 'Bee', 'Cee', 'Dee'])

    expect(getColumnSamples(files, 'Merchant')).toEqual(['Acme', 'Bee', 'Cee'])
  })

  it('trims whitespace and drops a blank cell', () => {
    const files = createColumn('Merchant', [' Acme ', 'Acme', '  '])

    expect(getColumnSamples(files, 'Merchant')).toEqual(['Acme'])
  })

  it('returns nothing for a header no file carries', () => {
    const files = createColumn('Merchant', ['Acme'])

    expect(getColumnSamples(files, 'Payee')).toEqual([])
  })
})
