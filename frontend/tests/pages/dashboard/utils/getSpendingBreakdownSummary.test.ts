/**
 * Tests the spending breakdown summary, so the entries, the total and the colour each slice is drawn
 * in cannot drift from the kind being shown or between renders
 */
import { describe, expect, it } from 'vitest'
import type { CategoryBreakdownEntry, SpendingBreakdownResponse } from '@/api/dashboard'
import {
  getSpendingBreakdownEntryColor,
  getSpendingBreakdownSummary,
} from '@/pages/dashboard/utils/getSpendingBreakdownSummary'
import { fxStatus } from './fixtures'

describe('spending breakdown summary', () => {
  it('builds spending breakdown summary with explicit totals and stable colours', () => {
    const expenseEntry: CategoryBreakdownEntry = {
      category_id: 'category-groceries',
      name: 'Groceries',
      category_kind: 'expense',
      amount: 12500,
    }
    const otherExpenseEntry: CategoryBreakdownEntry = {
      category_id: 'synthetic-other',
      name: 'Other',
      category_kind: 'expense',
      amount: 2500,
    }
    const incomeEntry: CategoryBreakdownEntry = {
      category_id: 'category-salary',
      name: 'Salary',
      category_kind: 'income',
      amount: 90000,
    }
    const breakdown: SpendingBreakdownResponse = {
      range: 'MTD',
      expense: [expenseEntry, otherExpenseEntry],
      income: [incomeEntry],
      expense_total: 20000,
      income_total: 90000,
      fx_status: fxStatus,
    }

    const summary = getSpendingBreakdownSummary(breakdown, 'spending', 'MTD')

    expect(summary.entries).toEqual([expenseEntry, otherExpenseEntry])
    expect(summary.total).toBe(20000)
    expect(summary.chartKey).toBe('spending-MTD')
    expect(summary.categoryKind).toBe('expense')
    expect(getSpendingBreakdownEntryColor(expenseEntry, summary)).toBe(summary.colors.get('category-groceries'))
    expect(getSpendingBreakdownEntryColor(otherExpenseEntry, summary)).toBe(summary.colors.get('expense-other'))

    expect(getSpendingBreakdownSummary(breakdown, 'income', 'YTD')).toMatchObject({
      entries: [incomeEntry],
      total: 90000,
      chartKey: 'income-YTD',
      categoryKind: 'income',
    })
  })
})
