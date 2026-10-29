/**
 * Tests what the refund flow decides in the browser: when the Refund button is offered, what a refund
 * starts as, what it is saved with, and what deleting a linked transaction warns about
 */
import { describe, expect, it } from 'vitest'
import { buildInitialTransactionForm } from '@/components/transactions/transaction-modal/utils/initialForm'
import { buildCreateTransactionPayload } from '@/components/transactions/transaction-modal/utils/payloads'
import {
  buildDeleteLinkNotice,
  buildRefundNote,
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

describe('buildDeleteLinkNotice', () => {
  it('says nothing for a transaction with no link', () => {
    expect(buildDeleteLinkNotice({ refund_of_transaction_id: null, refund_transaction_ids: [] })).toBe('')
  })

  it('counts every link the delete removes, from either side', () => {
    expect(buildDeleteLinkNotice({ refund_of_transaction_id: 'expense', refund_transaction_ids: [] })).toBe(
      'This also removes its refund link.',
    )
    expect(buildDeleteLinkNotice({ refund_of_transaction_id: null, refund_transaction_ids: ['a', 'b'] })).toBe(
      'This also removes its 2 refund links.',
    )
    expect(buildDeleteLinkNotice({ refund_of_transaction_id: 'expense', refund_transaction_ids: ['a'] })).toBe(
      'This also removes its 2 refund links.',
    )
  })
})
