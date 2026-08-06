/**
 * Tests the recent activity rows, so each row's title falls back to the note when there is no merchant
 * and income is told apart from spending
 */
import { describe, expect, it } from 'vitest'
import { getRecentActivityRows } from '@/pages/dashboard/utils/getRecentActivityRows'
import { createCategory, createTransaction } from './fixtures'

describe('recent activity rows', () => {
  it('builds recent activity rows with category and title fallbacks', () => {
    const rows = getRecentActivityRows(
      [
        createTransaction({
          id: 'income',
          category_id: 'category-income',
          merchant_name: 'Payroll',
          amount: 250000,
        }),
        createTransaction({
          id: 'note-fallback',
          category_id: 'category-expense',
          merchant_name: null,
          notes: 'Coffee shop',
        }),
      ],
      [
        createCategory({ id: 'category-income', name: 'Salary', kind: 'income' }),
        createCategory({ id: 'category-expense', name: 'Dining', kind: 'expense' }),
      ],
    )

    expect(rows).toMatchObject([
      { title: 'Payroll', isIncome: true, category: { name: 'Salary' } },
      { title: 'Coffee shop', isIncome: false, category: { name: 'Dining' } },
    ])
  })
})
