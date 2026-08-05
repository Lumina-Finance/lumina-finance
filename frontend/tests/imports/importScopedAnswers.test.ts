/**
 * Covers what each answer is filed under, so an answer given for one file and column is neither
 * reused for a different one that repeats the value nor dropped when an unrelated column changes
 */
import { describe, expect, it } from 'vitest'
import type { ImportFileDraft } from '@/pages/imports/types'
import {
  buildImportAnswerScope,
  emptyScopedImportAnswers,
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
    headers: ['Date', 'Amount', 'Account', 'Transfer To'],
    hasHeaderRow: true,
    rows: [{ Date: '2026-06-01', Amount: '10.00', Account: 'Savings', 'Transfer To': 'Savings' }],
    error: null,
  }
}

const FILE = createFile('file_1')

/**
 * Builds the resolver the workflow passes in, from the two mapped account columns and which
 * sources came from the second of them
 */
function accountSourceScope(accountColumn: string, counterpartyColumn: string, counterpartyOnly: string[] = []) {
  const counterpartyOnlyIds = new Set(counterpartyOnly)
  return (sourceId: string) => (
    counterpartyOnlyIds.has(sourceId)
      ? buildImportAnswerScope(counterpartyColumn, [FILE])
      : buildImportAnswerScope(accountColumn, [FILE])
  )
}

describe('scoped import answers', () => {
  it('reads back an answer while the column and file it was given for still hold', () => {
    const scope = accountSourceScope('Account', '')
    const stored = writeScopedImportAnswers(emptyScopedImportAnswers<string>(), { Savings: 'acc_1' }, scope)

    expect(readScopedImportAnswers(stored, scope)).toEqual({ Savings: 'acc_1' })
  })

  it('shows nothing for a value a different file repeats', () => {
    const stored = writeScopedImportAnswers(
      emptyScopedImportAnswers<string>(),
      { Savings: 'acc_1' },
      accountSourceScope('Account', ''),
    )
    const nextFile = () => buildImportAnswerScope('Account', [createFile('file_2')])

    expect(readScopedImportAnswers(stored, nextFile)).toEqual({})
  })

  it('shows nothing once the column an answer was read from changes', () => {
    const stored = writeScopedImportAnswers(
      emptyScopedImportAnswers<string>(),
      { Savings: 'acc_1' },
      accountSourceScope('Account', ''),
    )

    expect(readScopedImportAnswers(stored, accountSourceScope('Payee', ''))).toEqual({})
  })

  // The account sources come from two columns, and an answer belongs to whichever one supplied it
  it('keeps an account answer when only the counterparty column changes', () => {
    const stored = writeScopedImportAnswers(
      emptyScopedImportAnswers<string>(),
      { Chequing: 'acc_1' },
      accountSourceScope('Account', ''),
    )

    expect(readScopedImportAnswers(stored, accountSourceScope('Account', 'Transfer To'))).toEqual({
      Chequing: 'acc_1',
    })
  })

  it('drops a counterparty answer when the counterparty column changes, and keeps the account one', () => {
    const answered = accountSourceScope('Account', 'Transfer To', ['Savings'])
    const stored = writeScopedImportAnswers(
      emptyScopedImportAnswers<string>(),
      { Chequing: 'acc_1', Savings: 'outside' },
      answered,
    )

    expect(readScopedImportAnswers(stored, accountSourceScope('Account', 'Payee', ['Savings']))).toEqual({
      Chequing: 'acc_1',
    })
  })

  // Answering the same value under one column must not overwrite what it was answered as under
  // another, or putting the first column back would show the second column's answer
  it('holds an answer for the same value under each column it came from', () => {
    const underAccount = accountSourceScope('Account', '')
    const underCounterparty = accountSourceScope('', 'Transfer To', ['Savings'])
    const afterAccount = writeScopedImportAnswers(emptyScopedImportAnswers<string>(), { Savings: 'acc_1' }, underAccount)
    const afterBoth = writeScopedImportAnswers(afterAccount, { Savings: 'outside' }, underCounterparty)

    expect(readScopedImportAnswers(afterBoth, underCounterparty)).toEqual({ Savings: 'outside' })
    expect(readScopedImportAnswers(afterBoth, underAccount)).toEqual({ Savings: 'acc_1' })
  })

  it('drops an answer removed from the set in front of the user', () => {
    const scope = accountSourceScope('Account', '')
    const stored = writeScopedImportAnswers(
      emptyScopedImportAnswers<string>(),
      { Chequing: 'acc_1', Savings: 'acc_2' },
      scope,
    )
    const afterRemoval = writeScopedImportAnswers(stored, { Chequing: 'acc_1' }, scope)

    expect(readScopedImportAnswers(afterRemoval, scope)).toEqual({ Chequing: 'acc_1' })
  })

  it('starts with nothing answered', () => {
    expect(readScopedImportAnswers(emptyScopedImportAnswers<string>(), accountSourceScope('Account', ''))).toEqual({})
  })

  // Putting a column back is not the same as answering its values again, so the answers filed
  // under it come back with it
  it('shows an answer again when the column it was read from is mapped back', () => {
    const scope = accountSourceScope('Account', '')
    const stored = writeScopedImportAnswers(emptyScopedImportAnswers<string>(), { Savings: 'acc_1' }, scope)

    expect(readScopedImportAnswers(stored, accountSourceScope('', ''))).toEqual({})
    expect(readScopedImportAnswers(stored, scope)).toEqual({ Savings: 'acc_1' })
  })
})

describe('scoped row selection', () => {
  it('reads the ticks back while the column they were made under still holds', () => {
    const scope = accountSourceScope('Account', '')
    const stored = writeScopedSelection(emptyScopedImportAnswers<true>(), new Set(['Savings', 'Chequing']), scope)

    expect(readScopedSelection(stored, scope)).toEqual(new Set(['Savings', 'Chequing']))
  })

  it('leaves the table unticked when a different file supplies the sources', () => {
    const stored = writeScopedSelection(
      emptyScopedImportAnswers<true>(),
      new Set(['Savings']),
      accountSourceScope('Account', ''),
    )
    const nextFile = () => buildImportAnswerScope('Account', [createFile('file_2')])

    expect(readScopedSelection(stored, nextFile)).toEqual(new Set())
  })

  it('starts with nothing ticked', () => {
    expect(readScopedSelection(emptyScopedImportAnswers<true>(), accountSourceScope('Account', ''))).toEqual(new Set())
  })
})
