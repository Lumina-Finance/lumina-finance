/**
 * Tests what the refund flow decides in the browser: when the Refund button is offered, what a refund
 * starts as, what it is saved with, the transactions deleting a linked one can take with it, how the link picker
 * groups its rows by fit, and how it words the rows it folds and the refunds a chain holds
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { buildInitialTransactionForm } from '@/components/transactions/transaction-modal/utils/initialForm'
import { buildCreateTransactionPayload } from '@/components/transactions/transaction-modal/utils/payloads'
import {
  buildRefundNote,
  canLinkAsRefund,
  describeLinkedRefunds,
  describeUnlinkable,
  getLinkedTransactionIds,
  getRefundAccounts,
  getRefundRoom,
  getRefundStatus,
  getRefusedRooms,
  getSelectableAccounts,
  groupLinkCandidates,
  isRefundable,
  orderRefundsByDate,
} from '@/components/transactions/transaction-modal/utils/refund'
import { createAccount, createCategory, createTransaction, currencies } from './fixtures'

describe('isRefundable', () => {
  it('offers a refund only for money out in an expense category', () => {
    const expense = createTransaction({ amount: -500 })

    expect(isRefundable(expense, 'expense')).toBe(true)
    expect(isRefundable(expense, 'income')).toBe(false)
    expect(isRefundable(expense, 'transfer')).toBe(false)
    expect(isRefundable(expense, undefined)).toBe(false)
    expect(isRefundable(createTransaction({ amount: 500 }), 'expense')).toBe(false)
    expect(isRefundable(createTransaction({ amount: 0 }), 'expense')).toBe(false)
  })
})

describe('refund form', () => {
  const categories = [createCategory({ id: 'groceries', kind: 'expense' })]
  const accounts = [createAccount({ id: 'checking', currency: 'CAD' })]
  const expense = createTransaction({
    id: 'expense-1',
    account_id: 'checking',
    category_id: 'groceries',
    merchant_id: 'costco',
    merchant_name: 'Costco',
    amount: -12345,
    notes: 'Weekly shop',
    tags: [{ id: 'tax', group_id: null, name: 'Tax' }],
    tag_ids: ['tax'],
  })

  it('starts as the expense pointing the other way, dated today, with a note naming the expense', () => {
    const form = buildInitialTransactionForm({
      refundOf: expense,
      categories,
      currencies,
      selectableAccounts: accounts,
      timeZone: 'America/Toronto',
    })

    expect(form).toMatchObject({
      kind: 'expense',
      direction: 'credit',
      account_id: 'checking',
      category_id: 'groceries',
      merchant_id: 'costco',
      amount: '123.45',
      currency: 'CAD',
      notes: 'Refund of Costco',
      tag_ids: ['tax'],
    })
    expect(form.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(form.date).not.toBe(expense.dt)
  })

  it('names an expense with no merchant plainly', () => {
    expect(buildRefundNote(null)).toBe('Refund of an expense')
  })

  it('is saved as money coming in, linked to the expense in the same request', () => {
    const form = buildInitialTransactionForm({
      refundOf: expense,
      categories,
      currencies,
      selectableAccounts: accounts,
      timeZone: 'America/Toronto',
    })

    expect(buildCreateTransactionPayload(form, 2, expense.id)).toMatchObject({
      amount: 12345,
      refund_of_transaction_id: 'expense-1',
    })
  })

  it('sends no link for an ordinary transaction', () => {
    const form = buildInitialTransactionForm({
      categories,
      currencies,
      selectableAccounts: accounts,
      defaultAccountId: 'checking',
      timeZone: 'America/Toronto',
    })

    expect(buildCreateTransactionPayload(form, 2)).not.toHaveProperty('refund_of_transaction_id')
  })
})

describe('canLinkAsRefund', () => {
  it('offers money in, outside a transfer, that is not yet a refund', () => {
    expect(canLinkAsRefund({ amount: 500, refund_of_transaction_id: null }, 'income')).toBe(true)
    expect(canLinkAsRefund({ amount: 500, refund_of_transaction_id: null }, 'expense')).toBe(true)
  })

  it('refuses money out, a transfer, an unknown category and a refund already linked', () => {
    expect(canLinkAsRefund({ amount: -500, refund_of_transaction_id: null }, 'expense')).toBe(false)
    expect(canLinkAsRefund({ amount: 0, refund_of_transaction_id: null }, 'expense')).toBe(false)
    expect(canLinkAsRefund({ amount: 500, refund_of_transaction_id: null }, 'transfer')).toBe(false)
    expect(canLinkAsRefund({ amount: 500, refund_of_transaction_id: null }, undefined)).toBe(false)
    expect(canLinkAsRefund({ amount: 500, refund_of_transaction_id: 'expense' }, 'expense')).toBe(false)
  })
})

describe('getLinkedTransactionIds', () => {
  it('is empty for a transaction with no link', () => {
    expect(getLinkedTransactionIds({ refund_of_transaction_id: null, refund_transaction_ids: [] })).toEqual([])
  })

  it('lists the expense of a refund and the refunds of an expense', () => {
    expect(getLinkedTransactionIds({ refund_of_transaction_id: 'expense', refund_transaction_ids: [] })).toEqual([
      'expense',
    ])
    expect(getLinkedTransactionIds({ refund_of_transaction_id: null, refund_transaction_ids: ['a', 'b'] })).toEqual([
      'a',
      'b',
    ])
  })
})

describe('refund room', () => {
  const expense = { amount: -5000 }

  it('leaves what the refunds have not given back', () => {
    expect(getRefundRoom(expense, [])).toBe(5000)
    expect(getRefundRoom(expense, [{ amount: 1500 }, { amount: 1000 }])).toBe(2500)
  })

  it('calls an expense refunded in full only once nothing is left, and partly refunded while any refund counts', () => {
    expect(getRefundStatus(expense, 5000)).toBeNull()
    expect(getRefundStatus(expense, 4999)).toBe('partial')
    expect(getRefundStatus(expense, 1)).toBe('partial')
    expect(getRefundStatus(expense, 0)).toBe('full')
  })

  it('puts refunds oldest first once all have loaded, and keeps the linked order while any is loading', () => {
    const refunds: { id: string; dt?: string }[] = [
      { id: 'late', dt: '2026-11-18' },
      { id: 'early', dt: '2026-10-22' },
      { id: 'middle', dt: '2026-11-01' },
    ]
    const dateOf = (refund: { dt?: string }) => refund.dt
    expect(orderRefundsByDate(refunds, dateOf).map(({ id }) => id)).toEqual(['early', 'middle', 'late'])
    const loading = [refunds[0], { id: 'early' }, refunds[2]]
    expect(orderRefundsByDate(loading, dateOf)).toEqual(loading)
  })
})

describe('getRefundAccounts', () => {
  it('keeps only individually owned accounts in the currency of the expense', () => {
    const accounts = [
      { id: 'cad', currency: 'CAD', group_id: null },
      { id: 'usd', currency: 'USD', group_id: null },
      { id: 'group', currency: 'CAD', group_id: 'g' },
    ]
    expect(getRefundAccounts(accounts, 'CAD').map(({ id }) => id)).toEqual(['cad'])
    expect(getRefundAccounts(accounts, 'EUR')).toEqual([])
  })
})

// The Account dropdown of the create form, of a bank item's review and of a refund
describe('getSelectableAccounts', () => {
  const READ_ONLY = 'Records in USD are read-only. They can be archived or deleted'
  const accounts = [
    createAccount({ id: 'chequing' }),
    createAccount({ id: 'old', is_archived: true }),
    createAccount({ id: 'us-card', currency: 'USD', read_only_reason: READ_ONLY }),
    createAccount({ id: 'us-chequing', currency: 'USD' }),
  ]

  it('leaves out archived and read-only accounts', () => {
    expect(getSelectableAccounts(accounts).map(({ id }) => id)).toEqual(['chequing', 'us-chequing'])
  })

  it("keeps a bank item's own account, read-only or not, so its review names it", () => {
    expect(getSelectableAccounts(accounts, 'us-card').map(({ id }) => id)).toEqual([
      'chequing',
      'us-card',
      'us-chequing',
    ])
  })

  it("keeps a refund to the writable accounts in its expense's currency", () => {
    expect(getSelectableAccounts(accounts, undefined, 'USD').map(({ id }) => id)).toEqual(['us-chequing'])
  })
})

describe('getRefusedRooms', () => {
  const expense = createTransaction({ amount: -3713, currency: 'USD' })
  const refund = (id: string, amount: number) => createTransaction({ id, amount, currency: 'USD' })
  const candidates = [refund('a', 2000), refund('b', 1500), refund('c', 1200), refund('over', 3719)]
  const refused = (picked: string[]) => Object.fromEntries(getRefusedRooms(expense, candidates, 3713, picked))

  it('refuses a refund bigger than the whole expense, with what is left', () => {
    expect(refused([])).toEqual({ over: 3713 })
  })

  it('takes each pick off what is left for the others and gives it back when undone', () => {
    expect(refused(['a'])).toEqual({ over: 1713 })
    expect(refused(['a', 'b'])).toEqual({ c: 213, over: 213 })
    expect(refused(['b'])).toEqual({ over: 2213 })
  })

  it('never refuses a picked row, even when it uses up what is left', () => {
    expect(Object.fromEntries(getRefusedRooms(expense, [refund('a', 3713), refund('b', 100)], 3713, ['a']))).toEqual({
      b: 0,
    })
  })

  it('refuses nothing while what is left is not known yet', () => {
    expect(getRefusedRooms(expense, candidates, undefined, []).size).toBe(0)
  })

  it('refuses to a refund the expenses with no room for it, with what they have left', () => {
    const money = createTransaction({ amount: 2500, currency: 'USD' })
    const expenses = [
      createTransaction({ id: 'fits', amount: -2500, currency: 'USD', refunded_amount: 0 }),
      createTransaction({ id: 'short', amount: -2500, currency: 'USD', refunded_amount: 1000 }),
      createTransaction({ id: 'full', amount: -2500, currency: 'USD', refunded_amount: 2500 }),
    ]
    expect(Object.fromEntries(getRefusedRooms(money, expenses, undefined, []))).toEqual({ short: 1500, full: 0 })
  })
})

describe('groupLinkCandidates', () => {
  // An expense of $420.00 with $135.00 left after two refunds
  const expense = createTransaction({ amount: -42000, currency: 'USD' })
  const candidate = (id: string, amount: number, same_merchant: boolean, exact_amount: boolean) => ({
    ...createTransaction({ id, amount, currency: 'USD' }),
    same_merchant,
    exact_amount,
  })
  const candidates = [
    candidate('harbor-refund', 13500, true, true),
    candidate('harbor-credit', 6000, true, false),
    candidate('northwind', 13500, false, false),
    candidate('payroll', 320000, false, false),
    candidate('over', 14000, false, false),
  ]
  const ids = (rows: { id: string }[]) => rows.map(({ id }) => id)
  const grouped = (picked: string[]) => {
    const groups = groupLinkCandidates(candidates, getRefusedRooms(expense, candidates, 13500, picked))
    return {
      likely: ids(groups.likely),
      other: ids(groups.other),
      unlinkable: ids(groups.unlinkable.map((u) => u.candidate)),
    }
  }

  it('puts likely matches first and folds away what is more than is left', () => {
    expect(grouped([])).toEqual({
      likely: ['harbor-refund', 'harbor-credit'],
      other: ['northwind'],
      unlinkable: ['payroll', 'over'],
    })
  })

  it('folds the rows a pick leaves no room for, and brings them back when it is undone', () => {
    const unpicked = grouped([])

    expect(grouped(['harbor-credit'])).toEqual({
      likely: ['harbor-credit'],
      other: [],
      unlinkable: ['harbor-refund', 'northwind', 'payroll', 'over'],
    })
    expect(grouped([])).toEqual(unpicked)
  })

  it('puts every candidate in exactly one group, and a picked one never among those that cannot be linked', () => {
    const rows = fc.uniqueArray(
      fc.record({
        id: fc.uuid(),
        amount: fc.integer({ min: 1, max: 50000 }),
        same_merchant: fc.boolean(),
        exact_amount: fc.boolean(),
      }),
      { selector: (row) => row.id, maxLength: 12 },
    )
    fc.assert(
      fc.property(rows, fc.integer({ min: 0, max: 60000 }), fc.array(fc.nat()), (rows, room, picks) => {
        const offered = rows.map((row) => ({ ...createTransaction({ ...row, currency: 'USD' }), ...row }))
        const pickedIds = rows.length === 0 ? [] : picks.map((pick) => rows[pick % rows.length].id)
        const refused = getRefusedRooms(expense, offered, room, pickedIds)
        const groups = groupLinkCandidates(offered, refused)
        const placed = [...ids(groups.likely), ...ids(groups.other), ...ids(groups.unlinkable.map((u) => u.candidate))]

        expect(placed.toSorted()).toEqual(ids(offered).toSorted())
        expect(groups.unlinkable.every(({ candidate }) => !pickedIds.includes(candidate.id))).toBe(true)
        expect(groups.likely.every((row) => row.same_merchant || row.exact_amount)).toBe(true)
      }),
    )
  })
})

describe('describeUnlinkable', () => {
  const formatAmount = (amount: number) => `$${(amount / 100).toFixed(2)}`
  const expense = { amount: -42000 }
  const refund = { amount: 13500 }

  it('says why the refunds an expense cannot take are held back, with what is left', () => {
    expect(describeUnlinkable(expense, [7500, 7500], formatAmount)).toBe(
      "2 refunds can't be linked: each is more than the $75.00 left to refund",
    )
    expect(describeUnlinkable(expense, [7500], formatAmount)).toBe(
      "1 refund can't be linked: it's more than the $75.00 left to refund",
    )
    expect(describeUnlinkable(expense, [0, 0, 0], formatAmount)).toBe(
      "3 refunds can't be linked: nothing is left to refund",
    )
  })

  it('says why the expenses a refund cannot go to are held back, naming the refund when their rooms differ', () => {
    expect(describeUnlinkable(refund, [1500, 200], formatAmount)).toBe(
      "2 expenses can't be linked: each has less than $135.00 left to refund",
    )
    expect(describeUnlinkable(refund, [1500, 0], formatAmount)).toBe(
      "2 expenses can't be linked: each has less than $135.00 left to refund",
    )
    expect(describeUnlinkable(refund, [0], formatAmount)).toBe("1 expense can't be linked: it's already fully refunded")
    expect(describeUnlinkable(refund, [0, 0], formatAmount)).toBe(
      "2 expenses can't be linked: each is already fully refunded",
    )
  })
})

describe('describeLinkedRefunds', () => {
  it('counts the refunds a chain already holds', () => {
    expect(describeLinkedRefunds(1)).toBe('1 refund linked')
    expect(describeLinkedRefunds(2)).toBe('2 refunds linked')
  })
})
