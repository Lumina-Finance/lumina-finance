/**
 * Tests which transactions a bulk edit covers: the range a shift-click takes, the anchor it runs
 * from, the rows a day heading's tick takes, and the preview shown before either one is clicked
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import { MAX_BULK_EDIT_TRANSACTIONS } from '@/pages/transactions/components/bulk-edit/constants'
import {
  buildBulkEditFields,
  doesAnyResultingCategoryRecordTransferTarget,
  doesChosenCategoryRecordTransferTarget,
  getBulkMoveTargets,
  getTransferEndTargets,
  bulkSelectionReducer,
  canApplyBulkEdit,
  countTransferEndEffects,
  emptyBulkSelection,
  getBulkEditBlockers,
  groupSelectionMark,
  hasBulkEditChoice,
  previewSelection,
  resolveTransferEnds,
  rowSelectionMark,
  toggleChosenTag,
  type BulkSelectionState,
  type ChosenTagOption,
  type SelectableRow,
} from '@/pages/transactions/components/bulk-edit/selection'
import {
  chequingHalf,
  groceries,
  groceriesCategory,
  oldImport,
  pair,
  savingsHalf,
  toOutside,
  toSavings,
  transferCategory,
  unanswered,
  untouched,
} from './bulkEditFixtures'

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

  it('keeps a ticked row selected even while a re-aimed range would drop it', () => {
    let state = click(emptyBulkSelection, 'b')
    state = click(state, 'e', true)
    state = bulkSelectionReducer(state, { type: 'hover', id: 'c' })
    const preview = previewSelection(state, rows)

    expect(rowSelectionMark('e', state.selectedIds, preview)).toBe('selected')
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

// The two days a heading tick works over. Day one holds a read-only row, so a tick that took every
// row rather than every editable one shows up in the result
const dayOne = ['a', 'b', 'c']
const dayTwo = ['d', 'e']

/** Ticks a whole day heading, the way clicking its tick does */
function clickDay(state: BulkSelectionState, ids: string[], over = withReadOnlyC) {
  return bulkSelectionReducer(state, { type: 'toggleGroup', ids, rows: over })
}

/** Rests the pointer on a day heading's tick */
function hoverDay(state: BulkSelectionState, ids: string[] | null) {
  return bulkSelectionReducer(state, { type: 'hoverGroup', ids })
}

/** Rests the pointer on a row with shift held */
function hoverRow(state: BulkSelectionState, id: string | null) {
  return bulkSelectionReducer(state, { type: 'hover', id })
}

/** Marks one row against whatever preview the state is showing */
function markOf(state: BulkSelectionState, id: string, over = withReadOnlyC) {
  return rowSelectionMark(id, state.selectedIds, previewSelection(state, over))
}

describe("the rows a day heading's tick takes", () => {
  it('takes only the rows the app allows editing', () => {
    expect([...clickDay(emptyBulkSelection, dayOne).selectedIds]).toEqual(['a', 'b'])
  })

  it('keeps the ticks made in other days', () => {
    const withD = click(emptyBulkSelection, 'd', false, withReadOnlyC)
    expect([...clickDay(withD, dayOne).selectedIds].sort()).toEqual(['a', 'b', 'd'])
  })

  it('drops the day again once all of it is ticked, leaving the other days alone', () => {
    const both = clickDay(clickDay(emptyBulkSelection, dayOne), dayTwo)
    expect([...both.selectedIds].sort()).toEqual(['a', 'b', 'd', 'e'])
    expect([...clickDay(both, dayOne).selectedIds].sort()).toEqual(['d', 'e'])
  })

  it('offers nothing on a day with no row the app allows editing', () => {
    const readOnlyDay = ['c']
    expect(groupSelectionMark(readOnlyDay, withReadOnlyC, new Set())).toBe('unselectable')
    expect(clickDay(emptyBulkSelection, readOnlyDay)).toBe(emptyBulkSelection)
  })

  it('sets no anchor, so a shift-click straight after it ticks the one row it lands on', () => {
    const afterDay = clickDay(emptyBulkSelection, dayOne)
    expect([...click(afterDay, 'e', true, withReadOnlyC).selectedIds].sort()).toEqual(['a', 'b', 'e'])
  })
})

describe('how a day heading is marked', () => {
  it('reads mixed while only some of its rows are ticked', () => {
    expect(groupSelectionMark(dayOne, withReadOnlyC, new Set(['a']))).toBe('some')
  })

  it('reads ticked once every row the app allows editing is ticked', () => {
    expect(groupSelectionMark(dayOne, withReadOnlyC, new Set(['a', 'b']))).toBe('all')
  })

  it('reads mixed again once a later page adds more of that day', () => {
    expect(groupSelectionMark(['a', 'b'], withReadOnlyC, new Set(['a', 'b']))).toBe('all')
    expect(groupSelectionMark(['a', 'b', 'f'], withReadOnlyC, new Set(['a', 'b']))).toBe('some')
  })

  it('reads unticked while none of its rows are ticked', () => {
    expect(groupSelectionMark(dayOne, withReadOnlyC, new Set(['d']))).toBe('none')
  })
})

describe('the preview shown while the pointer rests on a day heading', () => {
  it('shows the whole day taken, keeping the ticks made in other days', () => {
    const ticked = click(click(emptyBulkSelection, 'a', false, withReadOnlyC), 'd', false, withReadOnlyC)
    const state = hoverDay(ticked, dayOne)
    expect(markOf(state, 'a')).toBe('selected')
    expect(markOf(state, 'b')).toBe('pending')
    expect(markOf(state, 'c')).toBe('none')
    expect(markOf(state, 'd')).toBe('selected')
  })

  it('keeps a fully ticked day selected while the tick previews dropping it, keeping the ticks made in other days', () => {
    const ticked = click(clickDay(emptyBulkSelection, dayOne), 'd', false, withReadOnlyC)
    const state = hoverDay(ticked, dayOne)
    expect(markOf(state, 'a')).toBe('selected')
    expect(markOf(state, 'b')).toBe('selected')
    expect(markOf(state, 'd')).toBe('selected')
  })

  it('replaces a range the pointer left pending', () => {
    const pendingRange = hoverRow(click(emptyBulkSelection, 'b', false, withReadOnlyC), 'e')
    expect(markOf(pendingRange, 'd')).toBe('pending')

    const state = hoverDay(pendingRange, dayTwo)
    expect(markOf(state, 'b')).toBe('selected')
    expect(markOf(state, 'c')).toBe('none')
    expect(markOf(state, 'd')).toBe('pending')
    expect(markOf(state, 'e')).toBe('pending')
  })
  it('drops the pending range outright, so moving off the heading leaves nothing lit', () => {
    const pendingRange = hoverRow(click(emptyBulkSelection, 'b', false, withReadOnlyC), 'e')
    const onHeading = hoverDay(pendingRange, dayTwo)
    expect(onHeading.hoveredId).toBeNull()

    // Leaving the tick for the heading's own label, which is still neither a row nor outside the list
    const offHeading = hoverDay(onHeading, null)
    expect(previewSelection(offHeading, withReadOnlyC)).toBeNull()
    expect(markOf(offHeading, 'e')).toBe('none')
  })

  it('moves to the day the pointer moved to, even where both days show the same number of rows', () => {
    const state = hoverDay(hoverDay(emptyBulkSelection, ['a', 'b']), ['d', 'e'])
    expect(state.hoveredGroupIds).toEqual(['d', 'e'])
  })

  it('goes when the pointer moves onto a row, letting a pending range show instead', () => {
    const onARow = hoverRow(hoverDay(click(emptyBulkSelection, 'b', false, withReadOnlyC), dayOne), 'e')
    expect(onARow.hoveredGroupIds).toBeNull()
    expect(markOf(onARow, 'e')).toBe('pending')
  })

  it('stays up when shift is released, which only takes the row preview', () => {
    const afterShiftRelease = hoverRow(hoverDay(emptyBulkSelection, dayOne), null)
    expect(afterShiftRelease.hoveredGroupIds).toEqual(dayOne)
  })


  it('stays up once the day is ticked, refreshed to the ids just toggled, so its rows read as ticked rather than as about to be dropped', () => {
    const state = clickDay(hoverDay(emptyBulkSelection, dayOne), dayOne)
    expect(state.hoveredGroupIds).toEqual(dayOne)
    expect(markOf(state, 'a')).toBe('selected')
    expect(markOf(state, 'b')).toBe('selected')
  })

  it('takes a pending range with it when a day is ticked', () => {
    const pendingRange = hoverRow(click(emptyBulkSelection, 'b', false, withReadOnlyC), 'e')
    const state = clickDay(pendingRange, dayTwo)
    expect(state.hoveredId).toBeNull()
    expect(markOf(state, 'c')).toBe('none')
  })
})

describe('toggling a day heading keeps its hover refreshed to the ids it just toggled', () => {
  it('selects a fully unticked day and keeps both rows reading selected under the still-hovered tick', () => {
    const hovering: BulkSelectionState = { ...emptyBulkSelection, hoveredGroupIds: ['a', 'b'] }
    const state = bulkSelectionReducer(hovering, { type: 'toggleGroup', ids: ['a', 'b'], rows })

    expect([...state.selectedIds].sort()).toEqual(['a', 'b'])
    expect(state.hoveredGroupIds).toEqual(['a', 'b'])
    expect(state.hoveredId).toBeNull()
    expect(rowSelectionMark('a', state.selectedIds, previewSelection(state, rows))).toBe('selected')
    expect(rowSelectionMark('b', state.selectedIds, previewSelection(state, rows))).toBe('selected')
  })

  it('drops a fully ticked day and marks both rows pending under the still-hovered tick', () => {
    const hovering: BulkSelectionState = {
      ...emptyBulkSelection,
      selectedIds: new Set(['a', 'b']),
      hoveredGroupIds: ['a', 'b'],
    }
    const state = bulkSelectionReducer(hovering, { type: 'toggleGroup', ids: ['a', 'b'], rows })

    expect(state.selectedIds.size).toBe(0)
    expect(state.hoveredGroupIds).toEqual(['a', 'b'])
    expect(rowSelectionMark('a', state.selectedIds, previewSelection(state, rows))).toBe('pending')
    expect(rowSelectionMark('b', state.selectedIds, previewSelection(state, rows))).toBe('pending')
  })

  it('reads a fully ticked day as still selected while the tick merely previews dropping it, with no click yet', () => {
    const state: BulkSelectionState = {
      ...emptyBulkSelection,
      selectedIds: new Set(['a', 'b']),
      hoveredGroupIds: ['a', 'b'],
    }

    expect(rowSelectionMark('a', state.selectedIds, previewSelection(state, rows))).toBe('selected')
    expect(rowSelectionMark('b', state.selectedIds, previewSelection(state, rows))).toBe('selected')
  })

  it('refreshes the hovered ids to the ones just toggled rather than the ones hovered before', () => {
    const threeRows: SelectableRow[] = [
      { id: 'r1', isReadOnly: false },
      { id: 'r2', isReadOnly: false },
      { id: 'r3', isReadOnly: false },
    ]
    const hovering: BulkSelectionState = { ...emptyBulkSelection, hoveredGroupIds: ['r1', 'r2'] }
    const state = bulkSelectionReducer(hovering, { type: 'toggleGroup', ids: ['r1', 'r2', 'r3'], rows: threeRows })

    expect([...state.selectedIds].sort()).toEqual(['r1', 'r2', 'r3'])
    expect(state.hoveredGroupIds).toEqual(['r1', 'r2', 'r3'])
  })

  it('nulls the hover only when the toggle is told to clear it, and always nulls the single-row hover', () => {
    const state = bulkSelectionReducer(emptyBulkSelection, {
      type: 'toggleGroup',
      ids: ['a', 'b'],
      rows,
      clearsHover: true,
    })

    expect(state.hoveredGroupIds).toBeNull()
    expect(state.hoveredId).toBeNull()
  })
})

describe('choosing a tag in the bulk edit panel', () => {
  const holiday: ChosenTagOption = { value: 'tag_holiday', label: 'Holiday' }
  const cash: ChosenTagOption = { value: 'tag_cash', label: 'Cash' }

  it('adds a tag that was not chosen yet', () => {
    expect(toggleChosenTag([], holiday)).toEqual([holiday])
  })

  it('removes a chosen tag, leaving the order of the rest as it stood', () => {
    expect(toggleChosenTag([holiday, cash], holiday)).toEqual([cash])
  })
})

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

  it('needs the clear box to take a note off, since an empty note box sends nothing', () => {
    expect(buildBulkEditFields(untouched({ note: '' }))).toEqual({})
    expect(buildBulkEditFields(untouched({ note: '', clearsNote: true }))).toEqual({ notes: null })
  })

  it('sends a tracked end as an account, dropping the currency it carries', () => {
    const fields = buildBulkEditFields(untouched({
      endsAreOffered: true,
      transferFrom: { scope: 'tracked', accountId: 'acc_2', currency: 'CAD' },
    }))

    expect(fields).toEqual({ transfer_from: { scope: 'tracked', account_id: 'acc_2' } })
  })

  it('sends the other end the same way', () => {
    const fields = buildBulkEditFields(untouched({
      endsAreOffered: true,
      transferTo: { scope: 'tracked', accountId: 'acc_3', currency: 'USD' },
    }))

    expect(fields).toEqual({ transfer_to: { scope: 'tracked', account_id: 'acc_3' } })
  })

  it('sends an end set to outside this app with no account', () => {
    const fields = buildBulkEditFields(untouched({
      endsAreOffered: true,
      transferTo: { scope: 'outside' },
    }))

    expect(fields).toEqual({ transfer_to: { scope: 'outside' } })
  })

  it('drops the move once an end is answered', () => {
    const choice = untouched({
      accountId: 'acc_1',
      endsAreOffered: true,
      transferFrom: { scope: 'tracked', accountId: 'acc_2', currency: 'CAD' },
    })

    expect(buildBulkEditFields(choice)).toEqual({ transfer_from: { scope: 'tracked', account_id: 'acc_2' } })
  })

  it('counts a category on its own as something to apply, whatever it is', () => {
    const choice = untouched({ categoryId: 'cat_1', endsAreOffered: true })

    expect(buildBulkEditFields(choice)).toEqual({ category_id: 'cat_1' })
    expect(hasBulkEditChoice(choice)).toBe(true)
  })

  it('drops an end left behind by a category the user changed away from', () => {
    const choice = untouched({
      categoryId: 'cat_1',
      endsAreOffered: false,
      transferFrom: { scope: 'tracked', accountId: 'acc_2', currency: 'CAD' },
    })

    // The controls are off screen under this category, so sending the end would refuse the whole
    // batch over something the user cannot see to undo
    expect(buildBulkEditFields(choice)).toEqual({ category_id: 'cat_1' })
  })

  it('has something to apply once an end is answered', () => {
    const choice = untouched({
      categoryId: 'cat_1',
      endsAreOffered: true,
      transferTo: { scope: 'outside' },
    })

    expect(hasBulkEditChoice(choice)).toBe(true)
  })
})

describe('what a bulk edit may do to the rows it covers', () => {
  /** An edit that sets a note and nothing else, which is the smallest thing a user can ask for */
  const noteOnly = untouched({ note: 'Corrected' })
  const noBlockers = {
    withoutMerchant: [], unansweredFarSide: [], ownAccountFarSide: [], sitsOutside: [], ownSideInAnotherCurrency: [],
  }

  describe('whether the ends can be set', () => {
    it('sends it for a selection of transfers under no new category', () => {
      const choice = untouched({
        transferTo: { scope: 'tracked', accountId: 'savings2', currency: 'CAD' },
        endsAreOffered: doesAnyResultingCategoryRecordTransferTarget(undefined, [toSavings]),
      })

      expect(buildBulkEditFields(choice)).toEqual({
        transfer_to: { scope: 'tracked', account_id: 'savings2' },
      })
    })

    it('does not offer it where no selected row records one', () => {
      expect(doesAnyResultingCategoryRecordTransferTarget(undefined, [groceries])).toBe(false)
    })

    it('offers it where only some selected rows record one', () => {
      expect(doesAnyResultingCategoryRecordTransferTarget(undefined, [groceries, toSavings])).toBe(true)
    })

    it('offers it once the chosen category records one, whatever the rows were', () => {
      expect(doesAnyResultingCategoryRecordTransferTarget(transferCategory, [groceries, toSavings])).toBe(true)
    })

    it('does not offer it once the chosen category is changed away from a transfer, whatever the rows were', () => {
      expect(doesAnyResultingCategoryRecordTransferTarget(groceriesCategory, pair)).toBe(false)
    })

    it('does not offer it against an empty selection', () => {
      expect(doesAnyResultingCategoryRecordTransferTarget(undefined, [])).toBe(false)
    })
  })

  describe('the rows the server would refuse', () => {
    it('counts a row with no merchant', () => {
      expect(getBulkEditBlockers([groceries, oldImport], noteOnly, undefined)).toEqual({
        ...noBlockers,
        withoutMerchant: ['b'],
      })
    })

    it('stops counting a row with no merchant once the edit sets one', () => {
      const choice = untouched({ merchantId: 'mer_1' })
      expect(getBulkEditBlockers([groceries, oldImport], choice, undefined)).toEqual(noBlockers)
    })

    it('counts a transfer with no far side recorded', () => {
      expect(getBulkEditBlockers([unanswered], noteOnly, undefined)).toEqual({
        ...noBlockers,
        unansweredFarSide: ['e'],
      })
    })

    it('treats a transfer recorded as going outside the tracked accounts as answered', () => {
      expect(getBulkEditBlockers([toOutside], noteOnly, undefined)).toEqual(noBlockers)
    })

    it('answers an unanswered money-out row once To is set, but not while only From is set', () => {
      const withTo = untouched({
        transferTo: { scope: 'tracked', accountId: 'savings', currency: 'CAD' },
        endsAreOffered: true,
      })
      expect(getBulkEditBlockers([unanswered], withTo, undefined).unansweredFarSide).toEqual([])

      const withFrom = untouched({
        transferFrom: { scope: 'tracked', accountId: 'cash', currency: 'CAD' },
        endsAreOffered: true,
      })
      expect(getBulkEditBlockers([unanswered], withFrom, undefined).unansweredFarSide).toEqual(['e'])
    })

    it('counts a row whose chosen far end is the one it sits in', () => {
      const choice = untouched({
        transferTo: { scope: 'tracked', accountId: 'chequing', currency: 'CAD' },
        endsAreOffered: true,
      })

      expect(getBulkEditBlockers([toSavings], choice, undefined)).toEqual({
        ...noBlockers,
        ownAccountFarSide: ['c'],
      })
    })

    it('counts a move into the account a row already records as its far side', () => {
      const choice = untouched({ accountId: 'savings' })
      expect(getBulkEditBlockers([toSavings], choice, undefined)).toEqual({
        ...noBlockers,
        ownAccountFarSide: ['c'],
      })
    })

    it('counts both rows of a pair once the chosen own end matches what each already records', () => {
      const choice = untouched({
        transferFrom: { scope: 'tracked', accountId: 'savings', currency: 'CAD' },
        endsAreOffered: true,
      })

      expect(getBulkEditBlockers(pair, choice, undefined).ownAccountFarSide.sort()).toEqual([
        'chequing_half', 'savings_half',
      ])
    })

    it('counts a row whose own end would sit outside the tracked accounts', () => {
      const choice = untouched({ transferFrom: { scope: 'outside' }, endsAreOffered: true })
      expect(getBulkEditBlockers([toSavings], choice, undefined)).toEqual({
        ...noBlockers,
        sitsOutside: ['c'],
      })
    })

    it('counts a money-in row whose own end would sit outside the tracked accounts the same way', () => {
      const choice = untouched({ transferTo: { scope: 'outside' }, endsAreOffered: true })
      expect(getBulkEditBlockers([savingsHalf], choice, undefined)).toEqual({
        ...noBlockers,
        sitsOutside: ['savings_half'],
      })
    })

    it('counts a row with no far side recorded as sitting outside rather than as unanswered, once its own end is set to outside', () => {
      // The server checks the own end before it ever asks whether the far side was answered, so a
      // row missing both is refused for the one reason the user can act on without touching To
      const choice = untouched({ transferFrom: { scope: 'outside' }, endsAreOffered: true })
      expect(getBulkEditBlockers([unanswered], choice, undefined)).toEqual({
        ...noBlockers,
        sitsOutside: ['e'],
      })
    })

    it('counts a row with no far side recorded as another currency rather than as unanswered, once its own end is set that way', () => {
      // The currency check reads the same resolved own end the unanswered check would otherwise
      // fall through to, and comes first, so a row missing both is refused for the currency alone
      const choice = untouched({
        transferFrom: { scope: 'tracked', accountId: 'us_savings', currency: 'USD' },
        endsAreOffered: true,
      })
      expect(getBulkEditBlockers([unanswered], choice, undefined)).toEqual({
        ...noBlockers,
        ownSideInAnotherCurrency: ['e'],
      })
    })

    it('counts a row whose own end would land in another currency, whatever its exchange rate', () => {
      const choice = untouched({
        transferFrom: { scope: 'tracked', accountId: 'us_savings', currency: 'USD' },
        endsAreOffered: true,
      })

      expect(getBulkEditBlockers([toSavings], choice, undefined)).toEqual({
        ...noBlockers,
        ownSideInAnotherCurrency: ['c'],
      })
    })

    it('counts a row recategorized into a transfer with no far side to fall back on', () => {
      expect(getBulkEditBlockers([groceries], untouched({ categoryId: 'cat_t' }), true)).toEqual({
        ...noBlockers,
        unansweredFarSide: ['a'],
      })
    })

    it('answers an expense recategorized into a transfer once To is set, but not without it', () => {
      const withTo = untouched({
        categoryId: 'cat_t',
        transferTo: { scope: 'tracked', accountId: 'savings', currency: 'CAD' },
        endsAreOffered: true,
      })
      expect(getBulkEditBlockers([groceries], withTo, true).unansweredFarSide).toEqual([])

      const withoutTo = untouched({ categoryId: 'cat_t', endsAreOffered: true })
      expect(getBulkEditBlockers([groceries], withoutTo, true).unansweredFarSide).toEqual(['a'])
    })

    it('stops asking for a far side once the row is recategorized away from a transfer', () => {
      const choice = untouched({ categoryId: 'cat_expense' })
      expect(getBulkEditBlockers([unanswered], choice, false)).toEqual(noBlockers)
    })

    it('counts each kind of blocking row separately', () => {
      expect(getBulkEditBlockers([oldImport, unanswered], noteOnly, undefined)).toEqual({
        ...noBlockers,
        withoutMerchant: ['b'],
        unansweredFarSide: ['e'],
      })
    })
  })

  describe("resolving a transfer's ends", () => {
    it('resolves both ends of a pair the way the service would', () => {
      const choice = untouched({
        transferFrom: { scope: 'tracked', accountId: 'cash', currency: 'CAD' },
        transferTo: { scope: 'tracked', accountId: 'savings', currency: 'CAD' },
        endsAreOffered: true,
      })

      expect(resolveTransferEnds(chequingHalf, choice, true)).toEqual({
        ownEnd: choice.transferFrom,
        farEnd: choice.transferTo,
      })
      expect(resolveTransferEnds(savingsHalf, choice, true)).toEqual({
        ownEnd: choice.transferTo,
        farEnd: choice.transferFrom,
      })
    })

    it("resolves the own end under reverse by flipping the row's own direction", () => {
      const choice = untouched({
        transferFrom: { scope: 'tracked', accountId: 'cash', currency: 'CAD' },
        transferTo: { scope: 'tracked', accountId: 'savings', currency: 'CAD' },
        direction: 'reverse',
        endsAreOffered: true,
      })

      // The Chequing half is money out on its own, so reverse makes it money in, which turns the
      // own and far ends around from the non-reversed case above
      expect(resolveTransferEnds(chequingHalf, choice, true)).toEqual({
        ownEnd: choice.transferTo,
        farEnd: choice.transferFrom,
      })
    })

    it('ignores both ends on a row whose resulting category records no far side', () => {
      const choice = untouched({
        transferFrom: { scope: 'tracked', accountId: 'cash', currency: 'CAD' },
        endsAreOffered: true,
      })

      expect(resolveTransferEnds(groceries, choice, false)).toEqual({ ownEnd: null, farEnd: null })
    })
  })

  describe('counting what an end edit would do', () => {
    it('reports one end moving the money-out half of a pair and recording on the money-in half', () => {
      const choice = untouched({
        transferFrom: { scope: 'tracked', accountId: 'cash', currency: 'CAD' },
        endsAreOffered: true,
      })

      expect(countTransferEndEffects(pair, choice, undefined).from).toEqual({ moves: 1, recordsOnly: 1 })
    })

    it('reports a non-transfer row as left alone alongside a moved transfer', () => {
      const choice = untouched({
        transferFrom: { scope: 'tracked', accountId: 'cash', currency: 'CAD' },
        endsAreOffered: true,
      })

      const effects = countTransferEndEffects([groceries, toSavings], choice, undefined)
      expect(effects.leftAlone).toBe(1)
      expect(effects.from.moves).toBe(1)
    })
  })

  describe('which way the money moves', () => {
    it('sends the direction the edit picked', () => {
      expect(buildBulkEditFields(untouched({ direction: 'debit' }))).toEqual({ direction: 'debit' })
      expect(buildBulkEditFields(untouched({ direction: 'credit' }))).toEqual({ direction: 'credit' })
      expect(buildBulkEditFields(untouched({ direction: 'reverse' }))).toEqual({ direction: 'reverse' })
    })

    it('sends nothing while the edit leaves it alone', () => {
      expect(buildBulkEditFields(untouched({ direction: null }))).toEqual({})
    })

    it('counts a direction on its own as something to apply', () => {
      expect(hasBulkEditChoice(untouched({ direction: 'debit' }))).toBe(true)
    })
  })

  describe('whether the edit can be written', () => {
    it('refuses while no control has been filled in', () => {
      expect(canApplyBulkEdit([groceries], untouched({}), noBlockers)).toBe(false)
    })

    it('refuses against an empty selection', () => {
      expect(canApplyBulkEdit([], noteOnly, noBlockers)).toBe(false)
    })

    it('refuses while the selection is over the cap', () => {
      const overCap = Array.from({ length: MAX_BULK_EDIT_TRANSACTIONS + 1 }, (_, index) => ({
        ...groceries,
        id: `row_${index}`,
      }))

      expect(canApplyBulkEdit(overCap, noteOnly, noBlockers)).toBe(false)
    })

    it('allows a selection sitting exactly on the cap', () => {
      const atCap = Array.from({ length: MAX_BULK_EDIT_TRANSACTIONS }, (_, index) => ({
        ...groceries,
        id: `row_${index}`,
      }))

      expect(canApplyBulkEdit(atCap, noteOnly, noBlockers)).toBe(true)
    })

    it('refuses while a transfer still has no far side recorded', () => {
      const blockers = getBulkEditBlockers([unanswered], noteOnly, undefined)
      expect(canApplyBulkEdit([unanswered], noteOnly, blockers)).toBe(false)
    })

    it('refuses while a row would end up recording the account it sits in', () => {
      const choice = untouched({
        transferTo: { scope: 'tracked', accountId: 'chequing', currency: 'CAD' },
        endsAreOffered: true,
      })
      const blockers = getBulkEditBlockers([toSavings], choice, undefined)

      expect(canApplyBulkEdit([toSavings], choice, blockers)).toBe(false)
    })

    it('refuses while an own end would sit outside the tracked accounts', () => {
      const choice = untouched({ transferFrom: { scope: 'outside' }, endsAreOffered: true })
      const blockers = getBulkEditBlockers([toSavings], choice, undefined)

      expect(canApplyBulkEdit([toSavings], choice, blockers)).toBe(false)
    })

    it('refuses while an own end would land in another currency', () => {
      const choice = untouched({
        transferFrom: { scope: 'tracked', accountId: 'us_savings', currency: 'USD' },
        endsAreOffered: true,
      })
      const blockers = getBulkEditBlockers([toSavings], choice, undefined)

      expect(canApplyBulkEdit([toSavings], choice, blockers)).toBe(false)
    })

    it('writes a note across a selection of transfers without touching their ends', () => {
      const choice = untouched({
        note: 'Reconciled',
        endsAreOffered: doesAnyResultingCategoryRecordTransferTarget(undefined, [toSavings]),
      })
      const blockers = getBulkEditBlockers([toSavings], choice, undefined)

      expect(buildBulkEditFields(choice)).toEqual({ notes: 'Reconciled' })
      expect(canApplyBulkEdit([toSavings], choice, blockers)).toBe(true)
    })

    it('refuses a recategorization into a transfer that leaves the far side unanswered', () => {
      const choice = untouched({ categoryId: 'cat_t', endsAreOffered: true })
      const blockers = getBulkEditBlockers([groceries], choice, true)

      // The category on its own is something to apply, so the refusal is the unanswered far side
      // rather than an edit that fills in nothing
      expect(hasBulkEditChoice(choice)).toBe(true)
      expect(blockers.unansweredFarSide).toEqual(['a'])
      expect(canApplyBulkEdit([groceries], choice, blockers)).toBe(false)
    })

    it('refuses while a blocking row stands, and allows it once a control settles that row', () => {
      const blocked = getBulkEditBlockers([oldImport], noteOnly, undefined)
      expect(canApplyBulkEdit([oldImport], noteOnly, blocked)).toBe(false)

      const withMerchant = untouched({ merchantId: 'mer_1' })
      const settled = getBulkEditBlockers([oldImport], withMerchant, undefined)
      expect(canApplyBulkEdit([oldImport], withMerchant, settled)).toBe(true)
    })
  })
})

describe('whether a chosen category records the other side of a transfer', () => {
  const category = (overrides: Partial<Category>): Category => ({
    id: 'cat_1',
    name: 'Groceries',
    kind: 'expense',
    icon: null,
    is_system: true,
    owner_id: null,
    group_id: null,
    ...overrides,
  } as Category)

  it('says no while nothing is chosen', () => {
    expect(doesChosenCategoryRecordTransferTarget(undefined)).toBe(false)
  })

  it('says no for an expense', () => {
    expect(doesChosenCategoryRecordTransferTarget(category({}))).toBe(false)
  })

  it('says yes for a transfer', () => {
    expect(doesChosenCategoryRecordTransferTarget(category({ kind: 'transfer', name: 'Transfer' }))).toBe(true)
  })

  it('says no for a balance adjustment, which corrects a balance rather than moving money', () => {
    expect(
      doesChosenCategoryRecordTransferTarget(category({ kind: 'transfer', name: 'Balance Adjustment' })),
    ).toBe(false)
  })

  it('reads the name alone, so one the user made themselves counts the same', () => {
    expect(
      doesChosenCategoryRecordTransferTarget(
        category({ kind: 'transfer', name: 'Balance Adjustment', is_system: false }),
      ),
    ).toBe(false)
  })
})

describe('the accounts a selection can move to', () => {
  const accounts = [
    { id: 'acc_1', currency: 'CAD' },
    { id: 'acc_2', currency: 'CAD', is_archived: true },
    { id: 'acc_3', currency: 'CAD', closed_at: '2026-03-01' },
    { id: 'acc_4', currency: 'USD' },
  ]

  it('offers the open accounts in the currency the selection uses', () => {
    expect(getBulkMoveTargets(accounts, ['CAD']).map((account) => account.id)).toEqual(['acc_1'])
  })

  it('offers nothing when the selection spans currencies', () => {
    expect(getBulkMoveTargets(accounts, ['CAD', 'USD'])).toEqual([])
  })

  it('offers nothing before anything is selected', () => {
    expect(getBulkMoveTargets(accounts, [])).toEqual([])
  })
})

describe("the accounts a transfer's ends can be set to", () => {
  const accounts = [
    { id: 'acc_1', currency: 'CAD' },
    { id: 'acc_2', currency: 'CAD', is_archived: true },
    { id: 'acc_3', currency: 'CAD', closed_at: '2026-03-01' },
    { id: 'acc_4', currency: 'USD' },
  ]

  it('offers every open account, whatever its currency', () => {
    expect(getTransferEndTargets(accounts).map((account) => account.id)).toEqual(['acc_1', 'acc_4'])
  })

  it('leaves out an archived or a closed account', () => {
    const ids = getTransferEndTargets(accounts).map((account) => account.id)
    expect(ids).not.toContain('acc_2')
    expect(ids).not.toContain('acc_3')
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
