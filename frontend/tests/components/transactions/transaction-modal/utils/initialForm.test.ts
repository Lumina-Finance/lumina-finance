/**
 * Tests the defaults the transaction modal opens with, so a new transaction's date and account and an
 * edited one's amount and tags cannot drift from the account, timezone and stored record behind them
 *
 * The missing-currency-table case also asserts on the patch and the validation that follow it, since
 * what the blank amount is worth only shows in whether a save would wipe the stored value
 *
 * A new bank item's form is checked whole, so a merchant or category filled in from anywhere, or an
 * amount rounded to fit its currency rather than left for the user, shows up
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BankValues } from '@/api/bank-sync'
import { NOTES_MAX_LENGTH } from '@/components/transactions/transaction-modal/constants'
import {
  buildInitialTransactionForm,
  buildReviewItemForm,
} from '@/components/transactions/transaction-modal/utils/initialForm'
import { buildUpdateTransactionPatch } from '@/components/transactions/transaction-modal/utils/payloads'
import { validateTransactionForm } from '@/components/transactions/transaction-modal/utils/validation'
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

    expect(
      buildInitialTransactionForm({
        categories,
        currencies,
        selectableAccounts: accounts,
        defaultAccountId: 'checking',
        timeZone: undefined,
      }),
    ).toMatchObject({
      account_id: 'checking',
      currency: 'CAD',
      date: '2026-06-13',
    })

    expect(
      buildInitialTransactionForm({
        transaction: createTransaction({
          category_id: 'groceries',
          amount: -9876,
          tags: [{ id: 'tax', group_id: null, name: 'Tax' }],
        }),
        categories,
        currencies,
        selectableAccounts: accounts,
        timeZone: undefined,
      }),
    ).toMatchObject({
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
    expect(buildUpdateTransactionPatch({ ...form, notes: 'Checked' }, transaction, null)).toEqual({ notes: 'Checked' })

    // The rest of the form still has to pass, so the blank amount cannot block an edit to anything else
    expect(validateTransactionForm(form, { isAmountLocked: true })).toEqual({})
    expect(validateTransactionForm(form)).toEqual({ amount: 'Enter an amount' })
  })
})

describe('a refund of an expense', () => {
  const expense = createTransaction({ category_id: 'groceries', amount: -3713, currency: 'CAD' })
  const options = {
    refundOf: expense,
    categories: [createCategory({ id: 'groceries', kind: 'expense' })],
    currencies,
    selectableAccounts: [createAccount({ id: 'checking', currency: 'CAD' })],
    timeZone: undefined,
  }

  it('starts at what is left to refund, to the cent', () => {
    expect(buildInitialTransactionForm({ ...options, refundRoom: 1713 }).amount).toBe('17.13')
    expect(buildInitialTransactionForm({ ...options, refundRoom: 5 }).amount).toBe('0.05')
  })

  it('starts at the whole expense when no room is given, and at nothing once none is left', () => {
    expect(buildInitialTransactionForm(options).amount).toBe('37.13')
    expect(buildInitialTransactionForm({ ...options, refundRoom: 0 }).amount).toBe('0.00')
    expect(buildInitialTransactionForm({ ...options, refundRoom: -200 }).amount).toBe('0.00')
  })

  it('stays on the account of the expense when it is listed, and otherwise starts on the first one listed', () => {
    const own = createAccount({ id: expense.account_id, currency: 'CAD' })
    const other = createAccount({ id: 'other', currency: 'CAD' })
    expect(buildInitialTransactionForm({ ...options, selectableAccounts: [other, own] }).account_id).toBe(own.id)
    expect(buildInitialTransactionForm({ ...options, selectableAccounts: [other] }).account_id).toBe('other')
    expect(buildInitialTransactionForm({ ...options, selectableAccounts: [] }).account_id).toBe('')
  })
})

describe('the form a new bank item opens with', () => {
  const item = {
    account_id: 'everyday',
    bank: { date: '2026-09-21', amount: -1250, raw_amount: null, description: 'COUNTDOWN 123' },
  }
  const withBank = (bank: Partial<BankValues>) => ({ ...item, bank: { ...item.bank, ...bank } })

  it('opens money out as an Expense in its account, for the day and amount the bank sent', () => {
    expect(buildReviewItemForm(withBank({ amount: -4210 }), 'CAD', currencies)).toEqual({
      kind: 'expense',
      direction: 'debit',
      account_id: 'everyday',
      category_id: '',
      merchant_id: '',
      amount: '42.10',
      currency: 'CAD',
      notes: 'COUNTDOWN 123',
      date: '2026-09-21',
      tag_ids: [],
      symmetric_transfer: false,
      counterparty_account_id: '',
    })
  })

  it('starts the notes with the bank description, cut to the length the Notes field takes', () => {
    const long = 'x'.repeat(NOTES_MAX_LENGTH + 40)

    expect(buildReviewItemForm(withBank({ description: long }), 'CAD', currencies).notes).toBe(
      'x'.repeat(NOTES_MAX_LENGTH),
    )
  })

  it('opens money in as Income', () => {
    expect(buildReviewItemForm(withBank({ amount: 50000 }), 'CAD', currencies)).toMatchObject({
      kind: 'income',
      direction: 'credit',
      amount: '500.00',
    })
  })

  it('opens an amount in a currency with no minor unit as whole units', () => {
    expect(buildReviewItemForm(withBank({ amount: -4210 }), 'JPY', currencies).amount).toBe('4210')
  })

  it('leaves the amount for the user in a currency the table does not carry, still as money out', () => {
    expect(buildReviewItemForm(withBank({ amount: -4210 }), 'XTS', currencies)).toMatchObject({
      amount: '',
      kind: 'expense',
      direction: 'debit',
    })
  })

  it.each([
    ['-42.105', 'expense', 'debit'],
    ['42.105', 'income', 'credit'],
  ] as const)(
    'leaves %s, more decimal places than the currency holds, for the user to enter',
    (rawAmount, kind, direction) => {
      const form = buildReviewItemForm(withBank({ amount: null, raw_amount: rawAmount }), 'CAD', currencies)

      expect(form).toMatchObject({ amount: '', kind, direction })
      expect(validateTransactionForm(form).amount).toBe('Enter an amount')
    },
  )
})
