/**
 * Tests transaction list helper behaviour so filter option ordering and active-count rules stay stable while toolbar components are split apart
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import {
  getAccountOptions,
  getActiveFilterCount,
  getCategoryOptions,
} from '@/transactions/utils/filterOptions'
import type { TransactionListAccount } from '@/transactions/types/transactionList'

function createCategory(overrides: Partial<Category>): Category {
  return {
    id: overrides.id ?? 'category',
    group_id: null,
    owner_id: null,
    name: overrides.name ?? 'Category',
    kind: overrides.kind ?? 'expense',
    icon: overrides.icon ?? null,
    is_system: false,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function createAccount(overrides: Partial<TransactionListAccount>): TransactionListAccount {
  return {
    id: overrides.id ?? 'account',
    name: 'name' in overrides ? overrides.name : 'Account',
    currency: 'USD',
    institution: null,
    is_archived: false,
    ...overrides,
  }
}

describe('filter option helpers', () => {
  it('builds account options with an unnamed-account fallback', () => {
    expect(getAccountOptions([
      createAccount({ id: 'checking', name: 'Checking' }),
      createAccount({ id: 'unnamed', name: undefined }),
    ])).toEqual([
      { value: 'checking', label: 'Checking' },
      { value: 'unnamed', label: 'Unnamed account' },
    ])
  })

  it('groups category options by kind and sorts names within each kind', () => {
    expect(getCategoryOptions([
      createCategory({ id: 'salary', name: 'Salary', kind: 'income', icon: '💵' }),
      createCategory({ id: 'travel', name: 'Travel', kind: 'expense', icon: null }),
      createCategory({ id: 'food', name: 'Food', kind: 'expense', icon: '🍽️' }),
      createCategory({ id: 'transfer', name: 'Transfer', kind: 'transfer', icon: '↔️' }),
    ])).toMatchObject([
      { value: 'food', label: 'Food', group: 'Expense' },
      { value: 'travel', label: 'Travel', group: 'Expense' },
      { value: 'salary', label: 'Salary', group: 'Income' },
      { value: 'transfer', label: 'Transfer', group: 'Transfer' },
    ])
  })

  it('does not count the account filter on fixed-account transaction lists', () => {
    expect(getActiveFilterCount({
      account_id: 'checking',
      category_id: 'food',
      from_date: '2026-06-01',
    }, false)).toBe(2)
    expect(getActiveFilterCount({
      account_id: 'checking',
      category_id: 'food',
      from_date: '2026-06-01',
    }, true)).toBe(3)
  })
})
