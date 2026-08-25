/**
 * Tests which transactions a bulk edit covers: the range a shift-click takes, the anchor it runs
 * from, and the preview shown while the pointer moves with shift held
 */
import { describe, expect, it } from 'vitest'
import {
  buildBulkEditFields,
  bulkSelectionReducer,
  emptyBulkSelection,
  hasBulkEditChoice,
  previewSelection,
  rowSelectionMark,
  type BulkEditChoice,
  type BulkSelectionState,
  type SelectableRow,
} from '@/pages/transactions/components/bulk-edit/selection'

const rows: SelectableRow[] = [
  { id: 'a', isReadOnly: false },
  { id: 'b', isReadOnly: false },
  { id: 'c', isReadOnly: false },
  { id: 'd', isReadOnly: false },
  { id: 'e', isReadOnly: false },
  { id: 'f', isReadOnly: false },
]

/** Applies a run of clicks, so each test reads as the sequence a user would perform */
function click(state: BulkSelectionState, id: string, withShift = false, over = rows) {
  return bulkSelectionReducer(state, { type: withShift ? 'extend' : 'toggle', id, rows: over })
}

const withReadOnlyC: SelectableRow[] = rows.map((row) =>
  row.id === 'c' ? { ...row, isReadOnly: true } : row,
)

describe('the range a shift-click takes', () => {
  it('takes every row between the two, both ends included', () => {
    let state = click(emptyBulkSelection, 'b')
    state = click(state, 'e', true)

    expect([...state.selectedIds].sort()).toEqual(['b', 'c', 'd', 'e'])
  })

  it('takes the same rows when aimed upward', () => {
    let state = click(emptyBulkSelection, 'e')
    state = click(state, 'b', true)

    expect([...state.selectedIds].sort()).toEqual(['b', 'c', 'd', 'e'])
  })

  it('leaves a tick made before the anchor in place', () => {
    let state = click(emptyBulkSelection, 'a')
    state = click(state, 'f')
    state = click(state, 'b')
    state = click(state, 'd', true)

    expect([...state.selectedIds].sort()).toEqual(['a', 'b', 'c', 'd', 'f'])
  })

  it('drops what the previous range took when re-aimed from the same anchor', () => {
    let state = click(emptyBulkSelection, 'b')
    state = click(state, 'e', true)
    state = click(state, 'c', true)

    expect([...state.selectedIds].sort()).toEqual(['b', 'c'])
  })

  it('ticks one row when no anchor has been set', () => {
    const state = click(emptyBulkSelection, 'd', true)

    expect([...state.selectedIds]).toEqual(['d'])
  })

  it('steps over a row the app does not allow editing', () => {
    let state = click(emptyBulkSelection, 'b', false, withReadOnlyC)
    state = click(state, 'e', true, withReadOnlyC)

    expect([...state.selectedIds].sort()).toEqual(['b', 'd', 'e'])
  })
})

describe('a row the app does not allow editing', () => {
  it('cannot be ticked by a plain click', () => {
    const state = click(emptyBulkSelection, 'c', false, withReadOnlyC)

    expect(state.selectedIds.size).toBe(0)
    expect(state.anchorId).toBeNull()
  })

  it('cannot be ticked by a shift-click made before any anchor is set', () => {
    const state = click(emptyBulkSelection, 'c', true, withReadOnlyC)

    expect(state.selectedIds.size).toBe(0)
    expect(state.anchorId).toBeNull()
  })

  it('still ends a range that runs through it', () => {
    let state = click(emptyBulkSelection, 'a', false, withReadOnlyC)
    state = click(state, 'c', true, withReadOnlyC)

    expect([...state.selectedIds].sort()).toEqual(['a', 'b'])
  })
})

describe('the preview shown while shift is held', () => {
  it('is the whole set the click would produce, not only what it would add', () => {
    let state = click(emptyBulkSelection, 'b')
    state = click(state, 'e', true)
    state = bulkSelectionReducer(state, { type: 'hover', id: 'c' })

    const preview = previewSelection(state, rows)

    expect(preview && [...preview].sort()).toEqual(['b', 'c'])
  })

  it('marks a ticked row the click would drop as no longer selected', () => {
    let state = click(emptyBulkSelection, 'b')
    state = click(state, 'e', true)
    state = bulkSelectionReducer(state, { type: 'hover', id: 'c' })
    const preview = previewSelection(state, rows)

    expect(rowSelectionMark('e', state.selectedIds, preview)).toBe('none')
    expect(rowSelectionMark('b', state.selectedIds, preview)).toBe('selected')
  })

  it('marks a row the click would add as pending', () => {
    let state = click(emptyBulkSelection, 'b')
    state = bulkSelectionReducer(state, { type: 'hover', id: 'd' })
    const preview = previewSelection(state, rows)

    expect(rowSelectionMark('d', state.selectedIds, preview)).toBe('pending')
  })

  it('is absent when the pointer is over nothing', () => {
    const state = click(emptyBulkSelection, 'b')

    expect(previewSelection(state, rows)).toBeNull()
  })
})

/** A panel with every control untouched, so each test states only the one it fills in */
function untouched(overrides: Partial<BulkEditChoice> = {}): BulkEditChoice {
  return {
    categoryId: '',
    merchantId: '',
    tagIds: [],
    accountId: '',
    date: '',
    note: '',
    clearsNote: false,
    transferTarget: null,
    categoryRecordsTransferTarget: false,
    ...overrides,
  }
}

describe('the details the panel sends', () => {
  it('leaves out a control the user did not touch', () => {
    expect(buildBulkEditFields(untouched({ categoryId: 'cat_1' }))).toEqual({ category_id: 'cat_1' })
  })

  it('sends every control the user did fill in', () => {
    const fields = buildBulkEditFields(untouched({
      categoryId: 'cat_1',
      merchantId: 'mer_1',
      tagIds: ['tag_1'],
      accountId: 'acc_1',
      date: '2026-08-14',
      note: 'Corrected',
    }))

    expect(fields).toEqual({
      category_id: 'cat_1',
      merchant_id: 'mer_1',
      add_tag_ids: ['tag_1'],
      account_id: 'acc_1',
      dt: '2026-08-14',
      notes: 'Corrected',
    })
  })

  it('sends nothing at all when every control is untouched', () => {
    expect(buildBulkEditFields(untouched())).toEqual({})
    expect(hasBulkEditChoice(untouched())).toBe(false)
  })

  it('counts one filled control as something to apply', () => {
    expect(hasBulkEditChoice(untouched({ tagIds: ['tag_1'] }))).toBe(true)
  })

  it('clears a note with null rather than an empty string', () => {
    expect(buildBulkEditFields(untouched({ clearsNote: true }))).toEqual({ notes: null })
  })

  it('leaves the note alone when the box is empty and nothing asked to clear it', () => {
    expect(buildBulkEditFields(untouched({ note: '' }))).toEqual({})
  })

  it('sends a tracked transfer target as an account and a scope', () => {
    const fields = buildBulkEditFields(untouched({
      transferTarget: { scope: 'tracked', accountId: 'acc_2' },
    }))

    expect(fields).toEqual({
      counterparty_account_scope: 'tracked',
      counterparty_account_id: 'acc_2',
    })
  })

  it('sends money that left the tracked accounts with no account', () => {
    const fields = buildBulkEditFields(untouched({ transferTarget: { scope: 'outside' } }))

    expect(fields).toEqual({
      counterparty_account_scope: 'outside',
      counterparty_account_id: null,
    })
  })

  it('has nothing to apply while a transfer category has no transfer target', () => {
    const choice = untouched({ categoryId: 'cat_1', categoryRecordsTransferTarget: true })

    expect(buildBulkEditFields(choice)).toEqual({ category_id: 'cat_1' })
    expect(hasBulkEditChoice(choice)).toBe(false)
  })

  it('has something to apply once the transfer target is answered', () => {
    const choice = untouched({
      categoryId: 'cat_1',
      categoryRecordsTransferTarget: true,
      transferTarget: { scope: 'outside' },
    })

    expect(hasBulkEditChoice(choice)).toBe(true)
  })
})

describe('what empties the selection', () => {
  it('clears the ticks, the anchor and the baseline', () => {
    let state = click(emptyBulkSelection, 'b')
    state = click(state, 'e', true)
    state = bulkSelectionReducer(state, { type: 'clear' })

    expect(state.selectedIds.size).toBe(0)
    expect(state.anchorId).toBeNull()
    expect(state.baselineIds.size).toBe(0)
  })

  it('drops a tick whose row has left the list', () => {
    let state = click(emptyBulkSelection, 'b')
    state = click(state, 'd')
    state = bulkSelectionReducer(state, { type: 'keepDisplayed', ids: ['a', 'b', 'c'] })

    expect([...state.selectedIds]).toEqual(['b'])
  })

  it('leaves the state untouched when every ticked row is still displayed', () => {
    let state = click(emptyBulkSelection, 'b')
    state = click(state, 'd')
    const settled = bulkSelectionReducer(state, {
      type: 'keepDisplayed',
      ids: rows.map((row) => row.id),
    })

    expect(settled).toBe(state)
  })
})
