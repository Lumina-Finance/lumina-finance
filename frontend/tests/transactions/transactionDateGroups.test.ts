/**
 * Tests transaction date-group helpers so calendar grouping and displayed daily totals stay stable while list rendering is split apart
 */
import { describe, expect, it } from 'vitest'
import type { Transaction } from '@/api/transactions'
import {
  getTransactionDateGroupTotal,
  groupTransactionsByDate,
} from '@/pages/transactions/utils/transactionDateGroups'
import type { TransactionListAccount } from '@/pages/transactions/types/transactionList'

/**
 * Builds the transaction fields needed by date-group helper tests
 */
function createTransaction(overrides: Partial<Transaction>): Transaction {
  return {
    id: overrides.id ?? 'transaction',
    created_by_user_id: 'user',
    account_id: overrides.account_id ?? 'account',
    dt: overrides.dt ?? '2026-06-01',
    merchant_id: null,
    merchant_name: null,
    category_id: 'category',
    amount: overrides.amount ?? 0,
    account_amount: overrides.account_amount ?? null,
    base_currency_amount: overrides.base_currency_amount ?? null,
    currency: 'USD',
    fx_rate: null,
    notes: null,
    other_account_id: null,
    other_account_scope: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    tag_ids: [],
    tags: [],
    ...overrides,
  }
}

describe('transaction date-group helpers', () => {
  it('keeps a transaction dated with a day the calendar does not have, under its raw heading', () => {
    const groups = groupTransactionsByDate([
      createTransaction({ id: 'impossible', dt: '2026-02-31', base_currency_amount: -500 }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].dateLabel).toBe('2026-02-31')
    expect(groups[0].transactions).toHaveLength(1)
  })

  it('groups transactions by browser-local calendar date without reordering rows', () => {
    const transactions = [
      createTransaction({ id: 'first', dt: '2026-06-02' }),
      createTransaction({ id: 'second', dt: '2026-06-02' }),
      createTransaction({ id: 'third', dt: '2026-06-01' }),
    ]

    expect(groupTransactionsByDate(transactions)).toEqual([
      {
        dateLabel: 'June 2, 2026',
        transactions: [transactions[0], transactions[1]],
      },
      {
        dateLabel: 'June 1, 2026',
        transactions: [transactions[2]],
      },
    ])
  })

  it('uses base-currency amounts on all-account lists and account amounts on fixed-account lists', () => {
    const transactions = [
      createTransaction({ base_currency_amount: 1200, account_amount: 1000 }),
      createTransaction({ base_currency_amount: -450, account_amount: -400 }),
    ]
    const fixedAccount: TransactionListAccount = { id: 'account', name: 'Checking' }

    expect(getTransactionDateGroupTotal(transactions)).toBe(750)
    expect(getTransactionDateGroupTotal(transactions, fixedAccount)).toBe(600)
  })
})
