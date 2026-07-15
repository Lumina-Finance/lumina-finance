/**
 * Tests Firefly III budget draft derivation and the category IDs the two-phase commit resolves from the transactions response
 */
import { describe, expect, it } from 'vitest'
import type { CsvRow, ImportFileDraft } from '@/pages/imports/types'
import type { FireflyBudgetDraft } from '@/pages/imports/firefly/types'
import { FIREFLY_BUDGET_ARCHIVED_REASON } from '@/pages/imports/firefly/constants'
import { buildFireflyBudgetDrafts, buildFireflyBudgetImportBudgets } from '@/pages/imports/firefly/utils'

/**
 * Creates a budgets export fixture from limit rows
 */
function createBudgetsFile(rows: CsvRow[]): ImportFileDraft {
  return {
    id: 'budgets',
    name: 'budgets.csv',
    size: 1024,
    headers: ['name', 'active', 'start_date', 'end_date', 'currency_code', 'amount'],
    hasHeaderRow: true,
    rows,
    error: null,
  }
}

/**
 * Creates one budgets export limit row, active unless a row overrides it
 */
function createLimitRow(overrides: Partial<CsvRow> = {}): CsvRow {
  return {
    name: 'Groceries',
    active: '1',
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

describe('buildFireflyBudgetDrafts', () => {
  it('disables an archived budget even when it is otherwise importable', () => {
    const budgetsFile = createBudgetsFile([createLimitRow({ active: '0' })])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
    })

    expect(draft.disabledReason).toBe(FIREFLY_BUDGET_ARCHIVED_REASON)
  })

  it('reads the archived flag off any of a budget\'s limit rows', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow({ name: 'Home Office', active: '0', start_date: '2024-01-01' }),
      createLimitRow({ name: 'Home Office', active: '0', start_date: '2024-02-01' }),
      createLimitRow({ name: 'Groceries', active: '1' }),
    ])

    const drafts = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow(), createTransactionRow({ budget: 'Home Office' })],
    })

    const byName = Object.fromEntries(drafts.map((draft) => [draft.name, draft]))
    expect(byName['Home Office'].disabledReason).toBe(FIREFLY_BUDGET_ARCHIVED_REASON)
    expect(byName.Groceries.disabledReason).toBeNull()
  })

  // An unrecognised flag leaves the budget visibly skipped rather than
  // silently importing a budget the user may have retired
  it('treats an unrecognised active value as archived', () => {
    const budgetsFile = createBudgetsFile([createLimitRow({ active: '' })])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
    })

    expect(draft.disabledReason).toBe(FIREFLY_BUDGET_ARCHIVED_REASON)
  })

  it('derives a sorted limit schedule and displays the latest amount', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow({ start_date: '2025-01-01', end_date: '2025-01-31', amount: '650.00' }),
      createLimitRow({ start_date: '2024-01-01', end_date: '2024-01-31', amount: '600.00' }),
      createLimitRow({ start_date: '2024-06-01', end_date: '2024-06-30', amount: '625.00' }),
    ])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
    })

    expect(draft.limits).toEqual([
      { start: '2024-01-01', amount: '600.00' },
      { start: '2024-06-01', amount: '625.00' },
      { start: '2025-01-01', amount: '650.00' },
    ])
    expect(draft.amount).toBe('650.00')
    expect(draft.currencyCode).toBe('CAD')
    expect(draft.periodStart).toBe('2024-02-01')
    expect(draft.categoryNames).toEqual(['Food'])
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
    })

    expect(draft.limits).toEqual([])
    expect(draft.disabledReason).toBe('The export has no limit amount for this budget')
  })

  it('disables a budget no imported transaction references', () => {
    const budgetsFile = createBudgetsFile([createLimitRow()])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [],
    })

    expect(draft.disabledReason).toBe('No imported transactions reference this budget')
  })

  it('disables a budget whose transactions carry no category', () => {
    const budgetsFile = createBudgetsFile([createLimitRow()])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow({ category: '' })],
    })

    expect(draft.categoryNames).toEqual([])
    expect(draft.disabledReason).toBe('No mapped categories reference this budget')
  })

  it('collects the distinct sorted categories referencing a budget', () => {
    const budgetsFile = createBudgetsFile([createLimitRow()])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [
        createTransactionRow({ category: 'Restaurants' }),
        createTransactionRow({ category: 'Food' }),
        createTransactionRow({ category: 'Food' }),
      ],
    })

    expect(draft.categoryNames).toEqual(['Food', 'Restaurants'])
  })
})

describe('buildFireflyBudgetImportBudgets', () => {
  /**
   * Creates one importable draft, since only importable drafts reach the commit
   */
  function createDraft(overrides: Partial<FireflyBudgetDraft> = {}): FireflyBudgetDraft {
    return {
      name: 'Groceries',
      amount: '600.00',
      currencyCode: 'CAD',
      limits: [{ start: '2024-01-01', amount: '600.00' }],
      periodStart: '2024-02-01',
      categoryNames: ['Food'],
      disabledReason: null,
      ...overrides,
    }
  }

  it('resolves category names through the ids the transactions commit reported', () => {
    const [budget] = buildFireflyBudgetImportBudgets(
      [createDraft({ categoryNames: ['Food', 'Restaurants'] })],
      { Food: 'category-food', Restaurants: 'category-restaurants', Rent: 'category-rent' },
    )

    expect(budget).toEqual({
      name: 'Groceries',
      currency: 'CAD',
      category_ids: ['category-food', 'category-restaurants'],
      period_start: '2024-02-01',
      limits: [{ start: '2024-01-01', amount: '600.00' }],
    })
  })

  it('drops a category name the commit response does not report', () => {
    const [budget] = buildFireflyBudgetImportBudgets(
      [createDraft({ categoryNames: ['Food', 'Unreported'] })],
      { Food: 'category-food' },
    )

    expect(budget.category_ids).toEqual(['category-food'])
  })

  it('collapses category names the commit resolved to one category', () => {
    const [budget] = buildFireflyBudgetImportBudgets(
      [createDraft({ categoryNames: ['Food', 'food'] })],
      { Food: 'category-food', food: 'category-food' },
    )

    expect(budget.category_ids).toEqual(['category-food'])
  })
})
