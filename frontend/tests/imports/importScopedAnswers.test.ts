/**
 * Covers the scope every per-source answer is held under, so an answer given for one file and
 * column is not reused for a different one that happens to repeat a value
 */
import { describe, expect, it } from 'vitest'
import type { ImportFileDraft } from '@/pages/imports/types'
import {
  buildImportAnswerScope,
  emptyScopedImportAnswers,
  emptyScopedSelection,
  readScopedImportAnswers,
  readScopedSelection,
  writeScopedImportAnswers,
  writeScopedSelection,
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
  it('reads the ticks back while the column they were made under still holds', () => {
    const scope = buildImportAnswerScope(['Account', ''], [createFile('file_1')])
    const stored = writeScopedSelection(scope, new Set(['Savings', 'Chequing']))

    expect(readScopedSelection(stored, scope)).toEqual(new Set(['Savings', 'Chequing']))
  })

  it('leaves the table unticked when the column is unmapped and mapped back', () => {
    const scope = buildImportAnswerScope(['Account', ''], [createFile('file_1')])
    const stored = writeScopedSelection(scope, new Set(['Savings']))
    const unmapped = buildImportAnswerScope(['', ''], [createFile('file_1')])

    expect(readScopedSelection(stored, unmapped)).toEqual(new Set())
    expect(readScopedSelection(writeScopedSelection(unmapped, new Set()), scope)).toEqual(new Set())
  })

  it('starts with nothing ticked', () => {
    const scope = buildImportAnswerScope(['Account', ''], [createFile('file_1')])

    expect(readScopedSelection(emptyScopedSelection(), scope)).toEqual(new Set())
  })
})
