/**
 * Tests Firefly III budget draft derivation and the category IDs the two-phase commit resolves from the transactions response
 */
import { describe, expect, it } from 'vitest'
import type { CsvRow, ImportFileDraft } from '@/pages/imports/types'
import type { FireflyBudgetDraft } from '@/pages/imports/firefly/types'
import {
  FIREFLY_BUDGET_MIXED_CURRENCIES_REASON,
  FIREFLY_BUDGET_NO_CATEGORIES_REASON,
  FIREFLY_BUDGET_NO_LIMITS_REASON,
  FIREFLY_BUDGET_NO_TRANSACTIONS_REASON,
  FIREFLY_BUDGET_UNREADABLE_DATES_REASON,
  FIREFLY_BUDGET_UNSUPPORTED_CADENCE_REASON,
} from '@/pages/imports/firefly/constants'
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
 * Creates one uploadable transaction row referencing a budget and category
 *
 * The identity fields matter because only rows that survive the payload
 * build may vote on a budget's tracked categories
 */
function createTransactionRow(overrides: Partial<CsvRow> = {}): CsvRow {
  return {
    journal_id: '1',
    type: 'Withdrawal',
    date: '2024-02-15T00:00:00-05:00',
    amount: '-25.00',
    currency_code: 'CAD',
    budget: 'Groceries',
    category: 'Food',
    ...overrides,
  }
}

describe('buildFireflyBudgetDrafts', () => {
  it('imports an archived budget as importable, with the flag carried on the draft', () => {
    const budgetsFile = createBudgetsFile([createLimitRow({ active: '0' })])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
    })

    expect(draft.isArchived).toBe(true)
    expect(draft.disabledReason).toBeNull()
  })

  it('reads the archived flag off any of a budget\'s limit rows', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow({ name: 'Home Office', active: '0', start_date: '2024-01-01' }),
      createLimitRow({ name: 'Home Office', active: '0', start_date: '2024-02-01', end_date: '2024-02-29' }),
      createLimitRow({ name: 'Groceries', active: '1' }),
    ])

    const drafts = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow(), createTransactionRow({ budget: 'Home Office' })],
    })

    const byName = Object.fromEntries(drafts.map((draft) => [draft.name, draft]))
    expect(byName['Home Office'].isArchived).toBe(true)
    expect(byName.Groceries.isArchived).toBe(false)
  })

  // An unrecognised flag reads as archived rather than silently importing a
  // budget the user may have retired as if it were still active
  it('treats an unrecognised active value as archived', () => {
    const budgetsFile = createBudgetsFile([createLimitRow({ active: '' })])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
    })

    expect(draft.isArchived).toBe(true)
  })

  // Being archived no longer settles a budget on its own, so it must still
  // fall through to another skip reason when one applies
  it('skips an archived budget for another reason when one applies', () => {
    const budgetsFile = createBudgetsFile([createLimitRow({ active: '0' })])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [],
    })

    expect(draft.isArchived).toBe(true)
    expect(draft.disabledReason).toBe(FIREFLY_BUDGET_NO_TRANSACTIONS_REASON)
  })

  it('derives a sorted limit period schedule and displays the latest amount', () => {
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
      { start: '2024-01-01', end: '2024-01-31', amount: '600.00' },
      { start: '2024-06-01', end: '2024-06-30', amount: '625.00' },
      { start: '2025-01-01', end: '2025-01-31', amount: '650.00' },
    ])
    expect(draft.amount).toBe('650.00')
    expect(draft.currencyCode).toBe('CAD')
    expect(draft.firstPeriodStart).toBe('2024-01-01')
    expect(draft.lastPeriodEnd).toBe('2025-01-31')
    expect(draft.periodLabel).toBe('Monthly')
    expect(draft.categoryNames).toEqual(['Food'])
    expect(draft.disabledReason).toBeNull()
  })

  it('labels the cadence of the latest limit period', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow({ name: 'Entertainment', start_date: '2024-01-01', end_date: '2024-03-31' }),
      createLimitRow({ name: 'Clothing', start_date: '2024-01-01', end_date: '2024-06-30' }),
      createLimitRow({ name: 'Giving', start_date: '2024-01-01', end_date: '2024-12-31' }),
      createLimitRow({ name: 'Fitness', start_date: '2024-01-01', end_date: '2024-01-07' }),
      createLimitRow({ name: 'Trip', start_date: '2024-10-04', end_date: '2024-10-26' }),
    ])
    const transactionRows = ['Entertainment', 'Clothing', 'Giving', 'Fitness', 'Trip']
      .map((budget) => createTransactionRow({ budget }))

    const drafts = buildFireflyBudgetDrafts({ budgetsFile, transactionRows })

    const byName = Object.fromEntries(drafts.map((draft) => [draft.name, draft]))
    expect(byName.Entertainment.periodLabel).toBe('Quarterly')
    expect(byName.Clothing.periodLabel).toBe('Every 6 mths')
    expect(byName.Giving.periodLabel).toBe('Yearly')
    expect(byName.Fitness.periodLabel).toBe('Weekly')
    expect(byName.Trip.periodLabel).toBe('One-off')
    for (const draft of drafts) expect(draft.disabledReason).toBeNull()
  })

  it('disables a budget repeating on a period length no cadence expresses', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow({ start_date: '2025-03-01', end_date: '2025-03-13', amount: '45.00' }),
      createLimitRow({ start_date: '2025-03-14', end_date: '2025-03-26', amount: '45.00' }),
    ])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
    })

    expect(draft.periodLabel).toBe('Every 13 days')
    expect(draft.disabledReason).toBe(FIREFLY_BUDGET_UNSUPPORTED_CADENCE_REASON)
  })

  // A regular history that ends on one odd partial period still continues on
  // a real cadence, so only a repeating odd length is skipped
  it('keeps a budget whose lone irregular period does not repeat', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow({ start_date: '2024-01-01', end_date: '2024-01-31' }),
      createLimitRow({ start_date: '2024-02-01', end_date: '2024-02-18' }),
    ])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
    })

    expect(draft.disabledReason).toBeNull()
  })

  // Firefly III can hold one limit per currency over the same window, so an
  // identical amount in a second currency must still read as mixed rather
  // than collapsing into the first currency's limit
  it('disables a budget whose same-window limits differ only by currency', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow({ currency_code: 'CAD', amount: '100.00' }),
      createLimitRow({ currency_code: 'USD', amount: '100.00' }),
    ])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
    })

    expect(draft.currencyCodes).toEqual(['CAD', 'USD'])
    expect(draft.disabledReason).toBe(FIREFLY_BUDGET_MIXED_CURRENCIES_REASON)
  })

  it('disables a budget whose limit periods mix currencies', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow({ start_date: '2024-01-01', currency_code: 'CAD' }),
      createLimitRow({ start_date: '2024-02-01', end_date: '2024-02-29', currency_code: 'USD' }),
    ])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
    })

    expect(draft.currencyCodes).toEqual(['CAD', 'USD'])
    expect(draft.disabledReason).toBe(FIREFLY_BUDGET_MIXED_CURRENCIES_REASON)
  })

  it('collapses exact duplicate limit rows to one schedule entry', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow({ start_date: '2024-01-01', amount: '600.00' }),
      createLimitRow({ start_date: '2024-01-01', amount: '600.00' }),
      createLimitRow({ start_date: '2024-06-01', end_date: '2024-06-30', amount: '625.00' }),
    ])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
    })

    expect(draft.limits).toEqual([
      { start: '2024-01-01', end: '2024-01-31', amount: '600.00' },
      { start: '2024-06-01', end: '2024-06-30', amount: '625.00' },
    ])
  })

  it('keeps conflicting amounts over the same period for the backend to reject', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow({ start_date: '2024-01-01', amount: '600.00' }),
      createLimitRow({ start_date: '2024-01-01', amount: '700.00' }),
    ])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
    })

    expect(draft.limits).toEqual([
      { start: '2024-01-01', end: '2024-01-31', amount: '600.00' },
      { start: '2024-01-01', end: '2024-01-31', amount: '700.00' },
    ])
  })

  it('drops limit rows missing a date, amount, or currency from the schedule', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow({ start_date: '', amount: '500.00' }),
      createLimitRow({ start_date: '2024-01-01', amount: '' }),
      createLimitRow({ start_date: '2024-03-01', end_date: '', amount: '610.00' }),
      createLimitRow({ start_date: '2024-05-01', end_date: '2024-05-31', currency_code: '', amount: '615.00' }),
      createLimitRow({ start_date: '2024-06-01', end_date: '2024-06-30', amount: '625.00' }),
    ])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
    })

    expect(draft.limits).toEqual([{ start: '2024-06-01', end: '2024-06-30', amount: '625.00' }])
    expect(draft.amount).toBe('625.00')
  })

  // A well-shaped date naming no real day marks the file as corrupted, so
  // the budget is refused before upload instead of failing on the backend
  it('disables a budget whose limit dates name no real calendar day', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow(),
      createLimitRow({ start_date: '2024-02-31', end_date: '2024-03-30' }),
    ])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
    })

    expect(draft.disabledReason).toBe(FIREFLY_BUDGET_UNREADABLE_DATES_REASON)
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
    expect(draft.disabledReason).toBe(FIREFLY_BUDGET_NO_LIMITS_REASON)
  })

  it('disables a budget no imported transaction references', () => {
    const budgetsFile = createBudgetsFile([createLimitRow()])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [],
    })

    expect(draft.disabledReason).toBe(FIREFLY_BUDGET_NO_TRANSACTIONS_REASON)
  })

  // A row dropped before upload never registers its category as an import
  // source, so it cannot back a budget the commit would then fail to resolve
  it('ignores transaction rows the payload build drops', () => {
    const budgetsFile = createBudgetsFile([createLimitRow()])

    const drafts = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [
        createTransactionRow({ journal_id: '' }),
        createTransactionRow({ tags: `travel,${'x'.repeat(65)}` }),
      ],
    })

    expect(drafts[0].disabledReason).toBe(FIREFLY_BUDGET_NO_TRANSACTIONS_REASON)
  })

  it('disables a budget whose transactions carry no category', () => {
    const budgetsFile = createBudgetsFile([createLimitRow()])

    const [draft] = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow({ category: '' })],
    })

    expect(draft.categoryNames).toEqual([])
    expect(draft.disabledReason).toBe(FIREFLY_BUDGET_NO_CATEGORIES_REASON)
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
      currencyCodes: ['CAD'],
      isArchived: false,
      limits: [{ start: '2024-01-01', end: '2024-01-31', amount: '600.00' }],
      firstPeriodStart: '2024-01-01',
      lastPeriodEnd: '2024-01-31',
      periodLabel: 'Monthly',
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
      limits: [{ start: '2024-01-01', end: '2024-01-31', amount: '600.00' }],
      is_archived: false,
    })
  })

  it('carries the archived flag into the payload', () => {
    const [budget] = buildFireflyBudgetImportBudgets([createDraft({ isArchived: true })], {})

    expect(budget.is_archived).toBe(true)
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
