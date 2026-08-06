/**
 * Tests the defaults the transaction modal opens with, so a new transaction's date and account and an
 * edited one's amount and tags cannot drift from the account, timezone and stored record behind them
 *
 * The missing-currency-table case also asserts on the patch and the validation that follow it, since
 * what the blank amount is worth only shows in whether a save would wipe the stored value
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildInitialTransactionForm } from '@/pages/transactions/components/transaction-modal/utils/initialForm'
import { buildUpdateTransactionPatch } from '@/pages/transactions/components/transaction-modal/utils/payloads'
import { validateTransactionForm } from '@/pages/transactions/components/transaction-modal/utils/validation'
import { createAccount, createCategory, createTransaction, currencies } from './fixtures'

afterEach(() => {
  vi.useRealTimers()
})

describe('transaction modal initial form', () => {
  it('builds create defaults from the selected account and edit defaults from the stored transaction', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-13T15:30:00'))
    const categories = [createCategory({ id: 'groceries', kind: 'expense' })]
    const accounts = [createAccount({ id: 'checking', currency: 'CAD' })]

    expect(buildInitialTransactionForm({
      categories,
      currencies,
      selectableAccounts: accounts,
      defaultAccountId: 'checking',
      timeZone: undefined,
    })).toMatchObject({
      account_id: 'checking',
      currency: 'CAD',
      date: '2026-06-13',
    })

    expect(buildInitialTransactionForm({
      transaction: createTransaction({
        category_id: 'groceries',
        amount: -9876,
        tags: [{ id: 'tax', group_id: null, name: 'Tax' }],
      }),
      categories,
      currencies,
      selectableAccounts: accounts,
      timeZone: undefined,
    })).toMatchObject({
      kind: 'expense',
      direction: 'debit',
      amount: '98.76',
      tag_ids: ['tax'],
    })
  })

  it('opens a new transaction on the profile timezone day rather than the browser calendar', () => {
    vi.useFakeTimers()
    // Late evening in Toronto on 30 June, already 1 July in UTC, so a zone mix-up shows up as a
    // different day and a different month
    vi.setSystemTime(new Date('2026-07-01T02:00:00Z'))
    const options = {
      categories: [createCategory({ id: 'groceries', kind: 'expense' })],
      currencies,
      selectableAccounts: [createAccount({ id: 'checking', currency: 'CAD' })],
      defaultAccountId: 'checking',
    }

    expect(buildInitialTransactionForm({ ...options, timeZone: 'America/Toronto' }).date).toBe('2026-06-30')
    expect(buildInitialTransactionForm({ ...options, timeZone: 'UTC' }).date).toBe('2026-07-01')
  })

  it('withholds the amount rather than scaling it by a guess when the currency list is missing', () => {
    const transaction = createTransaction({ amount: -500_000, currency: 'JPY' })
    const form = buildInitialTransactionForm({
      transaction,
      categories: [createCategory({ id: 'groceries' })],
      currencies: [],
      selectableAccounts: [createAccount({ id: 'checking' })],
      timeZone: undefined,
    })

    // Blank rather than 5000.00, which is what two assumed decimal places would have shown for ¥500,000
    expect(form.amount).toBe('')

    // A blank amount converts to zero, so leaving it out is what stops the save wiping the stored value
    expect(buildUpdateTransactionPatch(form, transaction, null)).toBeNull()
    expect(buildUpdateTransactionPatch({ ...form, notes: 'Checked' }, transaction, null))
      .toEqual({ notes: 'Checked' })

    // The rest of the form still has to pass, so the blank amount cannot block an edit to anything else
    expect(validateTransactionForm(form, { isAmountLocked: true })).toEqual({})
    expect(validateTransactionForm(form)).toEqual({ amount: 'Enter an amount' })
  })
})
