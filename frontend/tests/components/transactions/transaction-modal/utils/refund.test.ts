/**
 * Tests what the refund flow decides in the browser: when the Refund button is offered, what a refund
 * starts as, what it is saved with, and which transactions deleting a linked one can take with it
 */
import { describe, expect, it } from 'vitest'
import { buildInitialTransactionForm } from '@/components/transactions/transaction-modal/utils/initialForm'
import { buildCreateTransactionPayload } from '@/components/transactions/transaction-modal/utils/payloads'
import {
  buildRefundNote,
  canLinkAsRefund,
  exceedsRefundRoom,
  getLinkedTransactionIds,
  getRefundRoom,
  getRefusedRooms,
  isRefundable,
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
  const expense = { amount: -5000, currency: 'CAD' }

  it('leaves what the refunds in the expense currency have not given back', () => {
    expect(getRefundRoom(expense, [])).toBe(5000)
    expect(
      getRefundRoom(expense, [
        { amount: 1500, currency: 'CAD' },
        { amount: 1000, currency: 'CAD' },
      ]),
    ).toBe(2500)
  })

  it('ignores a refund in another currency, which cannot be added to the expense', () => {
    expect(getRefundRoom(expense, [{ amount: 4000, currency: 'USD' }])).toBe(5000)
  })

  it('refuses a refund that passes the room, and accepts one that fills it exactly', () => {
    expect(exceedsRefundRoom({ amount: 2501, currency: 'CAD' }, 'CAD', 2500)).toBe(true)
    expect(exceedsRefundRoom({ amount: 2500, currency: 'CAD' }, 'CAD', 2500)).toBe(false)
    expect(exceedsRefundRoom({ amount: 9999, currency: 'USD' }, 'CAD', 2500)).toBe(false)
  })
})

describe('getRefusedRooms', () => {
  const expense = createTransaction({ amount: -3713, currency: 'USD' })
  const refund = (id: string, amount: number, currency = 'USD') => createTransaction({ id, amount, currency })
  const candidates = [
    refund('a', 2000),
    refund('b', 1500),
    refund('c', 1200),
    refund('over', 3719),
    refund('cad', 9000, 'CAD'),
  ]
  const refused = (picked: string[]) => Object.fromEntries(getRefusedRooms(expense, candidates, 3713, picked))

  it('refuses a refund bigger than the whole expense, with what is left, and counts one in another currency for nothing', () => {
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
