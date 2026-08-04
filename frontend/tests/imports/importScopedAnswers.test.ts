/**
 * Covers the scope every per-source answer is held under, so an answer given for one file and
 * column is not reused for a different one that happens to repeat a value
 */
import { describe, expect, it } from 'vitest'
import type { ImportFileDraft } from '@/pages/imports/types'
import {
  buildImportAnswerScope,
  emptyScopedImportAnswers,
  keepScopedSelection,
  readScopedImportAnswers,
  writeScopedImportAnswers,
} from '@/pages/imports/utils'

/**
 * Creates a staged file fixture, whose id is what tells two uploads apart
 */
function createFile(id: string): ImportFileDraft {
  return {
    id,
    name: 'Statement.csv',
    size: 1024,
    headers: ['Date', 'Amount', 'Account'],
    hasHeaderRow: true,
    rows: [{ Date: '2026-06-01', Amount: '10.00', Account: 'Savings' }],
    error: null,
  }
}

describe('scoped import answers', () => {
  it('reads back the answers while the columns and files they were given for still hold', () => {
    const scope = buildImportAnswerScope(['Account', ''], [createFile('file_1')])
    const stored = writeScopedImportAnswers(scope, { Savings: 'acc_1' })

    expect(readScopedImportAnswers(stored, scope)).toEqual({ Savings: 'acc_1' })
  })

  it('drops the answers when a different file repeats the same value', () => {
    const firstScope = buildImportAnswerScope(['Account', ''], [createFile('file_1')])
    const stored = writeScopedImportAnswers(firstScope, { Savings: 'acc_1' })
    const secondScope = buildImportAnswerScope(['Account', ''], [createFile('file_2')])

    expect(readScopedImportAnswers(stored, secondScope)).toEqual({})
  })

  it('drops the answers when the column they were read from changes', () => {
    const scope = buildImportAnswerScope(['Account', ''], [createFile('file_1')])
    const stored = writeScopedImportAnswers(scope, { Savings: 'acc_1' })
    const remapped = buildImportAnswerScope(['Payee', ''], [createFile('file_1')])

    expect(readScopedImportAnswers(stored, remapped)).toEqual({})
  })

  // The account sources come from both mapped columns, so an answer given under either one stops
  // applying when either changes
  it('drops the answers when only the counterparty column changes', () => {
    const scope = buildImportAnswerScope(['Account', 'Transfer To'], [createFile('file_1')])
    const stored = writeScopedImportAnswers(scope, { Savings: 'acc_1' })
    const remapped = buildImportAnswerScope(['Account', 'Payee'], [createFile('file_1')])

    expect(readScopedImportAnswers(stored, remapped)).toEqual({})
  })

  it('starts with nothing answered', () => {
    const scope = buildImportAnswerScope(['Account', ''], [createFile('file_1')])

    expect(readScopedImportAnswers(emptyScopedImportAnswers<string>(), scope)).toEqual({})
  })
})

describe('scoped row selection', () => {
  it('keeps only the rows still in front of the user', () => {
    const selection = new Set(['Savings', 'Chequing'])

    expect(keepScopedSelection(selection, ['Savings'])).toEqual(new Set(['Savings']))
  })

  it('returns the same set when every selected row is still there', () => {
    const selection = new Set(['Savings'])

    expect(keepScopedSelection(selection, ['Savings', 'Chequing'])).toBe(selection)
  })

  it('empties the selection when the sources it was made against are gone', () => {
    expect(keepScopedSelection(new Set(['Savings']), [])).toEqual(new Set())
  })
})
