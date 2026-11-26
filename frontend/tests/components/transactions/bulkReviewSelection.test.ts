/**
 * Covers the rules a selection follows once it holds items waiting for review beside ledger
 * transactions: why Dismiss, Edit, Delete and Apply are off, the bulk edit's button wording, the
 * values a bulk add sends, the summary's note on the bank values an item keeps and the toasts afterwards
 *
 * These tests catch Dismiss running over a ledger transaction, Edit opening over an item missing its
 * amount, Apply counting only one kind toward the cap, a bulk add sending a note taken off or tags it
 * can't replace, a toast hiding the items that were skipped, a press of Approve all saying nothing
 * of the items it left to add or naming the old button, and a press of Reapply updated rules miscounting the
 * waiting items it updated or giving no word when it changed none
 */
import { describe, expect, it } from 'vitest'
import { MAX_BULK_EDIT_TRANSACTIONS } from '@/components/transactions/bulk-edit/constants'
import {
  NOTHING_TICKED_WITH_REVIEW,
  ONLY_REVIEW_ITEMS_DISMISSED,
  describeAddedButNotUpdated,
  describeAppliedRules,
  describeApproveAllAnswer,
  describeApprovedAll,
  describeBulkAdd,
  describeBulkDismiss,
  describeTickLimit,
  getBulkEditApplyLabel,
  getDismissBlockReason,
  getReviewEditBlockReason,
  toBulkAddValues,
} from '@/components/transactions/bulk-edit/reviewSelection'
import {
  buildBulkEditFields,
  getBulkEditBlockers,
  getBulkEditSelectionBlockReason,
} from '@/components/transactions/bulk-edit/selection'
import { describeBulkEdit } from '@/components/transactions/bulk-edit/summary'
import { createReviewItem } from './bank-review/fixtures'
import { groceries, untouched } from './bulkEditFixtures'

const LABELS = { accountLabelById: () => 'Account', categoryLabel: 'Dining', merchantLabel: 'Cafe', tagLabels: [] }

describe('why Dismiss is off', () => {
  it('runs only over items waiting for review', () => {
    expect(getDismissBlockReason(0, 3)).toBeUndefined()
    expect(getDismissBlockReason(1, 3)).toBe(ONLY_REVIEW_ITEMS_DISMISSED)
    expect(getDismissBlockReason(0, 0)).toBe(NOTHING_TICKED_WITH_REVIEW)
  })
})

describe('why Edit is off for items waiting for review', () => {
  const priced = createReviewItem('a', 'new', 'everyday')

  // The bank sent -12.345 to an account in cents, so the item's amount has to be typed in
  const unpriced = createReviewItem('b', 'new', 'everyday', {
    bank: {
      date: '2026-09-21',
      amount: null,
      raw_amount: '-12.345',
      description: 'GROCER b',
      note: 'GROCER b',
      merchant: null,
    },
  })

  it('stays on while every ticked item has a bank amount', () => {
    expect(getReviewEditBlockReason([priced])).toBeUndefined()
  })

  it('goes off once one ticked item is missing its amount, whatever else is ticked', () => {
    expect(getReviewEditBlockReason([priced, unpriced])).toBe('Items missing an amount are added one at a time')
  })
})

describe('the bulk edit button', () => {
  it('names what is added and what is updated', () => {
    expect(getBulkEditApplyLabel(3, 0)).toBe('Apply')
    expect(getBulkEditApplyLabel(0, 4)).toBe('Add 4 to ledger')
    expect(getBulkEditApplyLabel(3, 2)).toBe('Add 2 and update 3')
  })

  it('counts both kinds toward the cap', () => {
    const half = Array.from({ length: MAX_BULK_EDIT_TRANSACTIONS / 2 }, () => groceries)
    expect(getBulkEditSelectionBlockReason([], 2)).toBeUndefined()
    expect(getBulkEditSelectionBlockReason(half, MAX_BULK_EDIT_TRANSACTIONS / 2)).toBeUndefined()
    expect(getBulkEditSelectionBlockReason(half, MAX_BULK_EDIT_TRANSACTIONS / 2 + 1)).toBe(
      `Up to ${MAX_BULK_EDIT_TRANSACTIONS} transactions and review items can be edited at once`,
    )
  })
})

describe('why a row past the cap cannot be ticked', () => {
  it('names review items wherever the list offers them, since both kinds share the cap', () => {
    expect(describeTickLimit(true)).toBe(
      `Up to ${MAX_BULK_EDIT_TRANSACTIONS} transactions and review items can be ticked at once`,
    )
    expect(describeTickLimit(false)).toBe(`Up to ${MAX_BULK_EDIT_TRANSACTIONS} transactions can be ticked at once`)
  })
})

describe('the values a bulk add sends', () => {
  it('sends the merchant, category, tags, note and date chosen', () => {
    const fields = buildBulkEditFields(
      untouched({ merchantId: 'cafe', categoryId: 'dining', tagIds: ['work'], note: 'Team lunch', date: '2026-11-01' }),
    )
    expect(toBulkAddValues(fields)).toEqual({
      merchant_id: 'cafe',
      category_id: 'dining',
      tag_ids: ['work'],
      notes: 'Team lunch',
      dt: '2026-11-01',
    })
  })

  it('leaves out a note taken off and tags taken off, since a new item has neither', () => {
    const fields = buildBulkEditFields(
      untouched({ merchantId: 'cafe', categoryId: 'dining', clearsNote: true, overrideTags: true }),
    )
    expect(toBulkAddValues(fields)).toEqual({ merchant_id: 'cafe', category_id: 'dining' })
  })
})

describe('the summary of an edit that adds items waiting for review', () => {
  function notesOf(choice: ReturnType<typeof untouched>, reviewCount: number) {
    const blockers = getBulkEditBlockers([], choice, false, undefined)
    return describeBulkEdit(choice, [], blockers, LABELS, false, reviewCount)
  }

  it('says the items keep their bank amount, and their date unless one is chosen', () => {
    const choice = untouched({ merchantId: 'cafe', categoryId: 'dining' })
    expect(notesOf(choice, 1).notes).toEqual([
      { key: 'review-bank-values', text: 'The item waiting for review keeps its bank amount and date.' },
    ])
    expect(notesOf({ ...choice, date: '2026-11-01' }, 3).notes).toEqual([
      { key: 'review-bank-values', text: 'The 3 items waiting for review keep their bank amounts.' },
    ])
  })

  it('lists what the items get with no ledger transaction ticked', () => {
    const summary = notesOf(untouched({ merchantId: 'cafe', categoryId: 'dining' }), 2)
    expect(summary.rows.map((row) => [row.label, row.value])).toEqual([
      ['Merchant', 'Cafe'],
      ['Category', 'Dining'],
    ])
  })
})

describe('the toasts after a bulk decision', () => {
  it('says how many were added and updated, and how many still wait', () => {
    expect(describeBulkAdd(4, 0, null)).toBe('Added 4 items to your ledger.')
    expect(describeBulkAdd(2, 1, null)).toBe(
      "Added 2 items to your ledger. 1 item couldn't be added and still waits for review.",
    )
    expect(describeBulkAdd(2, 0, 3)).toBe('Added 2 items to your ledger and updated 3 transactions.')
    expect(describeBulkAdd(1, 2, 1)).toBe(
      "Added 1 item to your ledger and updated 1 transaction. 2 items couldn't be added and still wait for review.",
    )
  })

  it('says how many a press of Approve all added, and that more are left to add only when they are', () => {
    expect(describeApprovedAll(12, false)).toBe('Added 12 items to your ledger.')
    expect(describeApprovedAll(1, false)).toBe('Added 1 item to your ledger.')
    expect(describeApprovedAll(1000, true)).toBe(
      'Added 1000 items to your ledger. More items are left to add, so please press Approve all again.',
    )
    expect(describeApprovedAll(0, false)).toBe(
      'No items were added to your ledger: none of the waiting items was ready to add any more.',
    )
  })

  it("passes the server's answer to Approve all through, the count of items added and whether more are left", () => {
    expect(describeApproveAllAnswer({ added_ids: ['a', 'b'], more_to_add: false })).toBe(
      'Added 2 items to your ledger.',
    )
    expect(describeApproveAllAnswer({ added_ids: ['a', 'b'], more_to_add: true })).toBe(
      'Added 2 items to your ledger. More items are left to add, so please press Approve all again.',
    )
    expect(describeApproveAllAnswer({ added_ids: [], more_to_add: false })).toBe(describeApprovedAll(0, false))
  })

  it('says how many waiting items a press of Reapply updated rules updated, and that none changed when none did', () => {
    expect(describeAppliedRules(12)).toBe('Updated 12 waiting items with your import rules.')
    expect(describeAppliedRules(1)).toBe('Updated 1 waiting item with your import rules.')
    expect(describeAppliedRules(0)).toBe('Your import rules changed nothing on the waiting items.')
  })

  it('says the items went in when the ledger update was then refused', () => {
    expect(describeAddedButNotUpdated(2, 'A transaction was changed elsewhere.')).toBe(
      "Added 2 items to your ledger, but the app didn't update the ticked transactions. A transaction was changed elsewhere.",
    )
  })

  it('says how many were dismissed, and how many still wait', () => {
    expect(describeBulkDismiss(5, 0)).toBe('Dismissed 5 items.')
    expect(describeBulkDismiss(1, 1)).toBe("Dismissed 1 item. 1 item couldn't be dismissed and still waits for review.")
  })
})
