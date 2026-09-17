import { describe, expect, it } from 'vitest'
import { CREATE_ACCOUNT_VALUE } from '@/pages/imports/constants'
import { OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import { getImportAccountSelection, toggleAllImportAccountRows } from '@/pages/imports/utils/accountSelection'

const rows = [
  { id: 'existing', value: 'account-id', isHandAnswered: false, isCounterpartyOnly: false },
  { id: 'new', value: CREATE_ACCOUNT_VALUE, isHandAnswered: true, isCounterpartyOnly: false },
  { id: 'unanswered', value: '', isHandAnswered: false, isCounterpartyOnly: false },
  { id: 'explicit-outside', value: OUTSIDE_ACCOUNT_VALUE, isHandAnswered: true, isCounterpartyOnly: true },
  { id: 'automatic-outside', value: OUTSIDE_ACCOUNT_VALUE, isHandAnswered: false, isCounterpartyOnly: true },
]

describe('import account batch selection', () => {
  it('selects only editable rows and preserves another table selection', () => {
    const selection = new Set(['other-table', 'existing'])
    const next = toggleAllImportAccountRows(rows, selection)
    expect([...next]).toEqual(['other-table', 'new', 'unanswered', 'automatic-outside'])
    expect([...selection]).toEqual(['other-table', 'existing'])
    const state = getImportAccountSelection(rows, next)
    expect(state.allSelected).toBe(true)
    expect(state.someSelected).toBe(false)
    expect(state.selectedRows.map((row) => row.id)).toEqual(['new', 'unanswered', 'automatic-outside'])
    expect([...toggleAllImportAccountRows(rows, next)]).toEqual(['other-table'])
  })

  it('reports a partial selection among eligible rows only', () => {
    const state = getImportAccountSelection(rows, new Set(['new', 'existing']))
    expect(state.someSelected).toBe(true)
    expect(state.allSelected).toBe(false)
    expect(state.selectedRows.map((row) => row.id)).toEqual(['new'])
    expect([...state.validSelection]).toEqual(['new'])
  })

  it('removes a selection after an automatic match arrives without removing other tables', () => {
    const selection = new Set(['unanswered', 'other-table'])
    const matchedRows = rows.map((row) => row.id === 'unanswered' ? { ...row, value: 'matched-account' } : row)
    const state = getImportAccountSelection(matchedRows, selection)
    expect([...state.validSelection]).toEqual(['other-table'])
    expect(state.selectedRows).toEqual([])
    expect(getImportAccountSelection(rows, state.validSelection).selectedRows).toEqual([])
  })

  it('preserves concurrent cleanup from another table', () => {
    const second = [{ id: 'second-existing', value: 'account-2', isHandAnswered: true, isCounterpartyOnly: false }]
    const current = new Set(['existing', 'second-existing', 'new'])
    const afterFirst = getImportAccountSelection(rows, current).validSelection
    expect([...getImportAccountSelection(second, afterFirst).validSelection]).toEqual(['new'])
  })

  it('has no select-all state when every row is ineligible', () => {
    const state = getImportAccountSelection([rows[0], rows[3]], new Set(['existing', 'explicit-outside']))
    expect(state.eligibleRows).toEqual([])
    expect(state.selectedRows).toEqual([])
    expect(state.allSelected).toBe(false)
    expect(state.someSelected).toBe(false)
    expect([...state.validSelection]).toEqual([])
  })

  it('keeps valid selection identity and leaves an empty table untouched', () => {
    const selection = new Set(['new', 'other-table'])
    expect(getImportAccountSelection(rows, selection).validSelection).toBe(selection)
    expect(getImportAccountSelection([], selection).validSelection).toBe(selection)
  })
})
