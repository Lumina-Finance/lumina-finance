/**
 * Tests why a transaction row is marked read-only: an archived account's row, and now a row whose
 * category the current user cannot open, which the bulk edit rules and the row's own tick have to
 * agree on
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import type { Transaction } from '@/api/transactions'
import type { TransactionListAccount } from '@/pages/transactions/types/transactionList'
import { getTransactionReadOnlyReason } from '@/pages/transactions/utils/rowEditability'

const openAccount: TransactionListAccount = { id: 'chequing', is_archived: false, can_write: true }
const archivedAccount: TransactionListAccount = { id: 'old_account', is_archived: true, can_write: true }
const accountMap = new Map([[openAccount.id, openAccount], [archivedAccount.id, archivedAccount]])

const groceriesCategory: Category = {
  id: 'cat_g', name: 'Groceries', kind: 'expense', icon: null,
  is_system: true, owner_id: null, group_id: null,
} as Category
const categoryMap = new Map([[groceriesCategory.id, groceriesCategory]])

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'txn_1',
    created_by_user_id: 'user_1',
    account_id: openAccount.id,
    dt: '2026-08-23',
    merchant_id: 'mer_1',
    merchant_name: 'Merchant',
    category_id: groceriesCategory.id,
    amount: -1000,
    account_amount: null,
    base_currency_amount: null,
    currency: 'CAD',
    fx_rate: null,
    notes: null,
    counterparty_account_id: null,
    counterparty_account_scope: null,
    created_at: '2026-08-23T00:00:00Z',
    updated_at: '2026-08-23T00:00:00Z',
    tag_ids: [],
    tags: [],
    ...overrides,
  }
}

describe('getTransactionReadOnlyReason', () => {
  it('allows a row whose category is in the map', () => {
    expect(getTransactionReadOnlyReason(transaction(), accountMap, categoryMap)).toBeUndefined()
  })

  it('marks a row read-only whose category id is not in the map', () => {
    expect(getTransactionReadOnlyReason(transaction({ category_id: 'cat_gone' }), accountMap, categoryMap))
      .toBe('Uses a category you cannot open')
  })

  it('still marks an archived account row read-only for its own reason', () => {
    expect(getTransactionReadOnlyReason(transaction({ account_id: archivedAccount.id }), accountMap, categoryMap))
      .toBe('Archived · Read-only')
  })

  it('marks a read-only account row and an account with unknown capability as read-only', () => {
    const readOnly = { ...openAccount, id: 'shared', can_write: false }
    const unknown = { id: 'unknown' } as TransactionListAccount
    const accounts = new Map([...accountMap, [readOnly.id, readOnly], [unknown.id, unknown]])

    expect(getTransactionReadOnlyReason(transaction({ account_id: readOnly.id }), accounts, categoryMap))
      .toBe('Read-only access')
    expect(getTransactionReadOnlyReason(transaction({ account_id: unknown.id }), accounts, categoryMap))
      .toBe('Read-only access')
  })

  it('keeps writable closed history editable', () => {
    const closed = { ...openAccount, id: 'closed', closed_at: '2026-03-01T14:00:00Z' }
    expect(getTransactionReadOnlyReason(
      transaction({ account_id: closed.id }),
      new Map([[closed.id, closed]]),
      categoryMap,
    )).toBeUndefined()
  })

  it('uses the fixed account capability over a duplicate general account entry', () => {
    const fixed = { ...openAccount, can_write: false }
    expect(getTransactionReadOnlyReason(transaction(), accountMap, categoryMap, fixed)).toBe('Read-only access')
  })

  it('fails closed when the fixed account omits capability despite a writable general entry', () => {
    const fixed = { id: 'chequing' } as TransactionListAccount
    expect(getTransactionReadOnlyReason(transaction(), accountMap, categoryMap, fixed)).toBe('Read-only access')
  })

  it('gives the archived reason over the category reason when a row trips both', () => {
    expect(getTransactionReadOnlyReason(
      transaction({ category_id: 'cat_gone' }),
      accountMap,
      categoryMap,
      archivedAccount,
    )).toBe('Archived · Read-only')
  })
})
