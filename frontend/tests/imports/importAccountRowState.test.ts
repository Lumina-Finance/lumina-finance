/**
 * Tests the account mapping row rules so the line above the table keeps agreeing with what the
 * commit accepts, and so the batch bar's Apply keeps leaving a settled row alone
 */
import { describe, expect, it } from 'vitest'
import { CREATE_ACCOUNT_VALUE } from '@/pages/imports/constants'
import { OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import {
  canApplyBatchEditToRow,
  countImportAccountRowStates,
  getImportAccountRowState,
  type ImportAccountRowAnswer,
} from '@/pages/imports/utils'

/**
 * Creates a mapping row answer, defaulting to a source rows are written to with nothing chosen
 */
function createRow(overrides: Partial<ImportAccountRowAnswer> = {}): ImportAccountRowAnswer {
  return {
    value: '',
    isCounterpartyOnly: false,
    createType: '',
    createCurrency: '',
    isArchivedAccount: false,
    ...overrides,
  }
}

describe('what the mapping counter calls answered', () => {
  it('counts an unanswered row as review', () => {
    expect(getImportAccountRowState(createRow())).toBe('review')
  })

  it('counts a row pointing at an account as mapped', () => {
    expect(getImportAccountRowState(createRow({ value: 'checking' }))).toBe('mapped')
  })

  // payload.ts asks for both before it will create an account, adding "Choose account type" or
  // "Choose account currency", so a half-filled create row cannot read as finished
  it('counts a create row as new only once its type and currency are both set', () => {
    const creating = { value: CREATE_ACCOUNT_VALUE }

    expect(getImportAccountRowState(createRow({ ...creating, createType: 'checking', createCurrency: 'CAD' }))).toBe('new')
    expect(getImportAccountRowState(createRow({ ...creating, createType: 'checking' }))).toBe('review')
    expect(getImportAccountRowState(createRow({ ...creating, createCurrency: 'CAD' }))).toBe('review')
    expect(getImportAccountRowState(createRow(creating))).toBe('review')
  })

  // payload.ts accepts both of these on a counterparty source and refuses both by name on a source
  // rows are written to, which is the disagreement LF-386 and the archived case are about
  it('counts the outside answer and an archived account by whether rows are written to the source', () => {
    const outside = { value: OUTSIDE_ACCOUNT_VALUE }
    const archived = { value: 'savings', isArchivedAccount: true }

    expect(getImportAccountRowState(createRow({ ...outside, isCounterpartyOnly: true }))).toBe('mapped')
    expect(getImportAccountRowState(createRow(outside))).toBe('review')
    expect(getImportAccountRowState(createRow({ ...archived, isCounterpartyOnly: true }))).toBe('mapped')
    expect(getImportAccountRowState(createRow(archived))).toBe('review')
  })

  it('counts a whole table at once', () => {
    const rows = [
      createRow({ value: 'checking' }),
      createRow({ value: CREATE_ACCOUNT_VALUE, createType: 'checking', createCurrency: 'CAD' }),
      createRow({ value: CREATE_ACCOUNT_VALUE, createType: 'checking' }),
      createRow(),
    ]

    expect(countImportAccountRowStates(rows)).toEqual({ mapped: 1, new: 1, review: 2 })
  })

  it('counts nothing for an empty table', () => {
    expect(countImportAccountRowStates([])).toEqual({ mapped: 0, new: 0, review: 0 })
  })
})

describe('which rows the batch bar may edit', () => {
  it('leaves a row pointing at an account alone whether or not the user picked it', () => {
    expect(canApplyBatchEditToRow('checking', true, false)).toBe(false)
    expect(canApplyBatchEditToRow('checking', false, false)).toBe(false)
  })

  it('edits an unanswered row and one already set to create', () => {
    expect(canApplyBatchEditToRow('', false, false)).toBe(true)
    expect(canApplyBatchEditToRow(CREATE_ACCOUNT_VALUE, false, false)).toBe(true)
    expect(canApplyBatchEditToRow(CREATE_ACCOUNT_VALUE, true, false)).toBe(true)
  })

  // Every counterparty row rests on the outside answer until something else is chosen, so treating
  // that default as settled would leave the counterparty table's batch bar with nothing to do
  it('edits a transfer-only row given the outside answer by default, not one the user chose it for', () => {
    expect(canApplyBatchEditToRow(OUTSIDE_ACCOUNT_VALUE, false, true)).toBe(true)
    expect(canApplyBatchEditToRow(OUTSIDE_ACCOUNT_VALUE, true, true)).toBe(false)
  })

  // The commit refuses this answer on a source rows are written to, and that row's own dropdown
  // cannot put the answer back once it is changed, so the batch bar has to be able to lift it out
  it('edits a row answered outside on a source rows are written to, even by hand', () => {
    expect(canApplyBatchEditToRow(OUTSIDE_ACCOUNT_VALUE, true, false)).toBe(true)
    expect(canApplyBatchEditToRow(OUTSIDE_ACCOUNT_VALUE, false, false)).toBe(true)
  })

  // LF-253: eight sources, six already matched to accounts, all eight ticked, a currency set
  it('skips the matched rows and converts the unanswered ones in the eight-source sequence', () => {
    const matched = Array.from({ length: 6 }, (_, index) => `account-${index}`)
    const rows = [
      ...matched.map((value) => ({ value, isHandAnswered: false })),
      { value: '', isHandAnswered: false },
      { value: '', isHandAnswered: false },
    ]

    const editable = rows.filter((row) => canApplyBatchEditToRow(row.value, row.isHandAnswered, false))

    expect(editable).toHaveLength(2)
  })

  // Every row in the counterparty table rests on the outside default, so a rule treating that as
  // settled would leave its batch bar permanently disabled
  it('edits every row of a counterparty table resting on the default', () => {
    const rows = Array.from({ length: 8 }, () => ({ value: OUTSIDE_ACCOUNT_VALUE, isHandAnswered: false }))

    const editable = rows.filter((row) => canApplyBatchEditToRow(row.value, row.isHandAnswered, true))

    expect(editable).toHaveLength(8)
  })
})
