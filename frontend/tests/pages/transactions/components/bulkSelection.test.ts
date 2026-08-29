/**
 * Tests which transactions a bulk edit covers: the range a shift-click takes, the anchor it runs
 * from, the rows a day heading's tick takes, and the preview shown before either one is clicked
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import { MAX_BULK_EDIT_TRANSACTIONS } from '@/pages/transactions/components/bulk-edit/constants'
import {
  buildBulkEditFields,
  doesChosenCategoryRecordTransferTarget,
  getBulkMoveTargets,
  bulkSelectionReducer,
  canApplyBulkEdit,
  doEveryResultingCategoryRecordTransferTarget,
  emptyBulkSelection,
  getBulkEditBlockers,
  groupSelectionMark,
  hasBulkEditChoice,
  previewSelection,
  rowSelectionMark,
  type BulkEditChoice,
  type BulkSelectionState,
  type SelectableRow,
  type SelectedTransactionFacts,
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
    resultingCategoriesRecordTransferTarget: false,
    ...overrides,
  }
}

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

  it('shows a fully ticked day dropped, keeping the ticks made in other days', () => {
    const ticked = click(clickDay(emptyBulkSelection, dayOne), 'd', false, withReadOnlyC)
    const state = hoverDay(ticked, dayOne)
    expect(markOf(state, 'a')).toBe('none')
    expect(markOf(state, 'b')).toBe('none')
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


  it('goes once the day is ticked, so its rows read as ticked rather than as about to be dropped', () => {
    const state = clickDay(hoverDay(emptyBulkSelection, dayOne), dayOne)
    expect(previewSelection(state, withReadOnlyC)).toBeNull()
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

  it('sends a tracked transfer target as an account and a scope', () => {
    const fields = buildBulkEditFields(untouched({
      resultingCategoriesRecordTransferTarget: true,
      transferTarget: { scope: 'tracked', accountId: 'acc_2' },
    }))

    expect(fields).toEqual({
      counterparty_account_scope: 'tracked',
      counterparty_account_id: 'acc_2',
    })
  })

  it('sends money that left the tracked accounts with no account', () => {
    const fields = buildBulkEditFields(untouched({
      resultingCategoriesRecordTransferTarget: true,
      transferTarget: { scope: 'outside' },
    }))

    expect(fields).toEqual({
      counterparty_account_scope: 'outside',
      counterparty_account_id: null,
    })
  })

  it('counts a category on its own as something to apply, whatever it is', () => {
    const choice = untouched({ categoryId: 'cat_1', resultingCategoriesRecordTransferTarget: true })

    expect(buildBulkEditFields(choice)).toEqual({ category_id: 'cat_1' })
    expect(hasBulkEditChoice(choice)).toBe(true)
  })

  it('drops a transfer target left behind by a category the user changed away from', () => {
    const choice = untouched({
      categoryId: 'cat_1',
      resultingCategoriesRecordTransferTarget: false,
      transferTarget: { scope: 'tracked', accountId: 'acc_2' },
    })

    // The control is off screen under this category, so sending it would refuse the whole batch
    // over something the user cannot see to undo
    expect(buildBulkEditFields(choice)).toEqual({ category_id: 'cat_1' })
  })

  it('has something to apply once the transfer target is answered', () => {
    const choice = untouched({
      categoryId: 'cat_1',
      resultingCategoriesRecordTransferTarget: true,
      transferTarget: { scope: 'outside' },
    })

    expect(hasBulkEditChoice(choice)).toBe(true)
  })
})

describe('what a bulk edit may do to the rows it covers', () => {
  const transferCategory = {
    id: 'cat_t', name: 'Transfer', kind: 'transfer', icon: null,
    is_system: true, owner_id: null, group_id: null,
  } as Category

  const groceries: SelectedTransactionFacts = {
    id: 'a', accountId: 'chequing', hasMerchant: true,
    recordsFarSide: false, hasFarSideRecorded: false, farSideAccountId: null,
  }
  const oldImport: SelectedTransactionFacts = {
    id: 'b', accountId: 'chequing', hasMerchant: false,
    recordsFarSide: false, hasFarSideRecorded: false, farSideAccountId: null,
  }
  const toSavings: SelectedTransactionFacts = {
    id: 'c', accountId: 'chequing', hasMerchant: true,
    recordsFarSide: true, hasFarSideRecorded: true, farSideAccountId: 'savings',
  }
  const toOutside: SelectedTransactionFacts = {
    id: 'd', accountId: 'chequing', hasMerchant: true,
    recordsFarSide: true, hasFarSideRecorded: true, farSideAccountId: null,
  }
  const unanswered: SelectedTransactionFacts = {
    id: 'e', accountId: 'chequing', hasMerchant: true,
    recordsFarSide: true, hasFarSideRecorded: false, farSideAccountId: null,
  }

  /** An edit that sets a note and nothing else, which is the smallest thing a user can ask for */
  const noteOnly = untouched({ note: 'Corrected' })
  const noBlockers = { withoutMerchant: [], unansweredFarSide: [], ownAccountFarSide: [] }

  describe('whether the far account can be set', () => {
    it('sends it for a selection of transfers under no new category', () => {
      const choice = untouched({
        transferTarget: { scope: 'tracked', accountId: 'savings2' },
        resultingCategoriesRecordTransferTarget:
          doEveryResultingCategoryRecordTransferTarget(undefined, [toSavings]),
      })

      expect(buildBulkEditFields(choice)).toEqual({
        counterparty_account_scope: 'tracked',
        counterparty_account_id: 'savings2',
      })
    })

    it('does not offer it where no selected row records one', () => {
      expect(doEveryResultingCategoryRecordTransferTarget(undefined, [groceries])).toBe(false)
    })

    it('does not offer it where only some selected rows record one', () => {
      expect(doEveryResultingCategoryRecordTransferTarget(undefined, [groceries, toSavings])).toBe(false)
    })

    it('offers it once the chosen category records one, whatever the rows were', () => {
      expect(doEveryResultingCategoryRecordTransferTarget(transferCategory, [groceries, toSavings])).toBe(true)
    })

    it('does not offer it against an empty selection', () => {
      expect(doEveryResultingCategoryRecordTransferTarget(undefined, [])).toBe(false)
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

    it('counts a row whose chosen far account is the one it sits in', () => {
      const choice = untouched({
        transferTarget: { scope: 'tracked', accountId: 'chequing' },
        resultingCategoriesRecordTransferTarget: true,
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

    it('counts a row recategorized into a transfer with no far side to fall back on', () => {
      expect(getBulkEditBlockers([groceries], untouched({ categoryId: 'cat_t' }), true)).toEqual({
        ...noBlockers,
        unansweredFarSide: ['a'],
      })
    })

    it('stops asking for a far side once the row is recategorized away from a transfer', () => {
      const choice = untouched({ categoryId: 'cat_expense' })
      expect(getBulkEditBlockers([unanswered], choice, false)).toEqual(noBlockers)
    })

    it('counts each kind of blocking row separately', () => {
      expect(getBulkEditBlockers([oldImport, unanswered], noteOnly, undefined)).toEqual({
        withoutMerchant: ['b'],
        unansweredFarSide: ['e'],
        ownAccountFarSide: [],
      })
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
        transferTarget: { scope: 'tracked', accountId: 'chequing' },
        resultingCategoriesRecordTransferTarget: true,
      })
      const blockers = getBulkEditBlockers([toSavings], choice, undefined)

      expect(canApplyBulkEdit([toSavings], choice, blockers)).toBe(false)
    })

    it('writes a note across a selection of transfers without touching their far side', () => {
      const choice = untouched({
        note: 'Reconciled',
        resultingCategoriesRecordTransferTarget:
          doEveryResultingCategoryRecordTransferTarget(undefined, [toSavings]),
      })
      const blockers = getBulkEditBlockers([toSavings], choice, undefined)

      expect(buildBulkEditFields(choice)).toEqual({ notes: 'Reconciled' })
      expect(canApplyBulkEdit([toSavings], choice, blockers)).toBe(true)
    })

    it('refuses a recategorization into a transfer that leaves the far side unanswered', () => {
      const choice = untouched({ categoryId: 'cat_t', resultingCategoriesRecordTransferTarget: true })
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
