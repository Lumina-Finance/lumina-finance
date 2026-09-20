/**
 * Tests transaction list helper behaviour so filter option ordering and active-count rules stay stable while toolbar components are split apart
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import {
  getAccountOptions,
  getActiveFilterCount,
  getActiveFacetCount,
  getCategoryOptions,
} from '@/pages/transactions/utils/filterOptions'
import type { TransactionListAccount } from '@/pages/transactions/types/transactionList'

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
    can_write: true,
    is_archived: false,
    ...overrides,
  }
}

describe('filter option helpers', () => {
  it('counts restored category and date facets without opening the draft', () => {
    expect(getActiveFacetCount({ category_id: ['food', 'travel'], from_date: '2026-06-01', to_date: '2026-06-30' }, true)).toBe(2)
    expect(getActiveFacetCount({}, true)).toBe(0)
  })

  it('counts currency and zero-valued amount bounds as one facet', () => {
    expect(getActiveFacetCount({ currency: 'CAD', min_amount: 0, max_amount: 100 }, true)).toBe(1)
    expect(getActiveFacetCount({ min_amount: 0 }, true)).toBe(1)
  })

  it('excludes fixed account and currency scopes but retains applied bounds', () => {
    const filters = { account_id: ['checking'], currency: 'CAD' }
    expect(getActiveFacetCount(filters, false, 'CAD')).toBe(0)
    expect(getActiveFacetCount({ ...filters, max_amount: 0 }, false, 'CAD')).toBe(1)
    expect(getActiveFacetCount({ merchant_id: ['shop'], tag_id: ['tag'] }, true)).toBe(2)
  })

  it('builds account options with an unnamed-account fallback', () => {
    expect(getAccountOptions([
      createAccount({ id: 'checking', name: 'Checking' }),
      createAccount({ id: 'unnamed', name: undefined }),
    ])).toEqual([
      { value: 'checking', label: 'Checking', imageUrl: null },
      { value: 'unnamed', label: 'Unnamed account', imageUrl: null },
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
      account_id: ['checking'],
      category_id: ['food'],
      from_date: '2026-06-01',
    }, false)).toBe(2)
    expect(getActiveFilterCount({
      account_id: ['checking'],
      category_id: ['food'],
      from_date: '2026-06-01',
    }, true)).toBe(3)
  })
})
