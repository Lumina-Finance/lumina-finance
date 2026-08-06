/**
 * Tests the transaction modal category dropdown, so the order the kinds appear in and the sorting
 * within each kind cannot drift from the kind the transaction is being recorded as
 */
import { describe, expect, it } from 'vitest'
import { buildCategoryOptions } from '@/pages/transactions/components/transaction-modal/utils/categories'
import { createCategory } from './fixtures'

describe('transaction modal category options', () => {
  it('builds category options with the active kind first and sorted names within each kind', () => {
    expect(buildCategoryOptions([
      createCategory({ id: 'salary', name: 'Salary', kind: 'income', icon: '💵' }),
      createCategory({ id: 'rent', name: 'Rent', kind: 'expense' }),
      createCategory({ id: 'food', name: 'Food', kind: 'expense', icon: '🍽️' }),
      createCategory({ id: 'transfer', name: 'Transfer', kind: 'transfer' }),
    ], 'income')).toMatchObject([
      { value: 'salary', label: 'Salary', group: 'Income' },
      { value: 'food', label: 'Food', group: 'Expense' },
      { value: 'rent', label: 'Rent', group: 'Expense' },
      { value: 'transfer', label: 'Transfer', group: 'Transfer' },
    ])
  })
})
