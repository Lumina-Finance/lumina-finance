/**
 * Tests Firefly III budget draft derivation so the import step sends the full limit schedule and shows the latest amount
 */
import { describe, expect, it } from 'vitest'
import type { CsvRow, ImportFileDraft } from '@/pages/imports/types'
import { buildFireflyBudgetDrafts } from '@/pages/imports/firefly/utils'

/**
 * Creates a budgets export fixture from limit rows
 */
function createBudgetsFile(rows: CsvRow[]): ImportFileDraft {
  return {
    id: 'budgets',
    name: 'budgets.csv',
    size: 1024,
    headers: ['name', 'start_date', 'end_date', 'currency_code', 'amount'],
    hasHeaderRow: true,
    rows,
    error: null,
  }
}

/**
 * Creates one budgets export limit row
 */
function createLimitRow(overrides: Partial<CsvRow> = {}): CsvRow {
  return {
    name: 'Groceries',
    start_date: '2024-01-01',
    end_date: '2024-01-31',
    currency_code: 'CAD',
    amount: '600.00',
    ...overrides,
  }
}

/**
 * Creates one transaction row referencing a budget and category
 */
function createTransactionRow(overrides: Partial<CsvRow> = {}): CsvRow {
  return {
    date: '2024-02-15T00:00:00-05:00',
    budget: 'Groceries',
    category: 'Food',
    ...overrides,
  }
}

const categorySourceIds = { Food: 'category-food' }

describe('buildFireflyBudgetDrafts', () => {
  it('derives a sorted limit schedule and displays the latest amount', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow({ start_date: '2025-01-01', end_date: '2025-01-31', amount: '650.00' }),
      createLimitRow({ start_date: '2024-01-01', end_date: '2024-01-31', amount: '600.00' }),
      createLimitRow({ start_date: '2024-06-01', end_date: '2024-06-30', amount: '625.00' }),
    ])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
      categorySourceIds,
    })

    expect(draft.limits).toEqual([
      { start: '2024-01-01', amount: '600.00' },
      { start: '2024-06-01', amount: '625.00' },
      { start: '2025-01-01', amount: '650.00' },
    ])
    expect(draft.amount).toBe('650.00')
    expect(draft.currencyCode).toBe('CAD')
    expect(draft.periodStart).toBe('2024-02-01')
    expect(draft.categoryIds).toEqual(['category-food'])
    expect(draft.disabledReason).toBeNull()
  })

  it('collapses exact duplicate limit rows to one schedule entry', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow({ start_date: '2024-01-01', amount: '600.00' }),
      createLimitRow({ start_date: '2024-01-01', amount: '600.00' }),
      createLimitRow({ start_date: '2024-06-01', amount: '625.00' }),
    ])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
      categorySourceIds,
    })

    expect(draft.limits).toEqual([
      { start: '2024-01-01', amount: '600.00' },
      { start: '2024-06-01', amount: '625.00' },
    ])
  })

  it('keeps conflicting amounts on the same start for the backend to reject', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow({ start_date: '2024-01-01', amount: '600.00' }),
      createLimitRow({ start_date: '2024-01-01', amount: '700.00' }),
    ])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
      categorySourceIds,
    })

    expect(draft.limits).toEqual([
      { start: '2024-01-01', amount: '600.00' },
      { start: '2024-01-01', amount: '700.00' },
    ])
  })

  it('drops limit rows without a start date or amount from the schedule', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow({ start_date: '', amount: '500.00' }),
      createLimitRow({ start_date: '2024-01-01', amount: '' }),
      createLimitRow({ start_date: '2024-06-01', amount: '625.00' }),
    ])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
      categorySourceIds,
    })

    expect(draft.limits).toEqual([{ start: '2024-06-01', amount: '625.00' }])
    expect(draft.amount).toBe('625.00')
  })

  it('disables a budget whose export rows cannot form a limit schedule', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow({ start_date: '', amount: '' }),
    ])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
      categorySourceIds,
    })

    expect(draft.limits).toEqual([])
    expect(draft.disabledReason).toBe('The export has no limit amount for this budget')
  })

  it('disables a budget no imported transaction references', () => {
    const budgetsFile = createBudgetsFile([createLimitRow()])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [],
      categorySourceIds,
    })

    expect(draft.disabledReason).toBe('No imported transactions reference this budget')
  })
})
