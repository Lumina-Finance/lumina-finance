/**
 * Tests Firefly III budget draft derivation and the category IDs the two-phase commit resolves from the transactions response
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { FireflyBudgetImportRecurrence } from '@/api/firefly-imports'
import type { CsvRow, ImportFileDraft } from '@/pages/imports/types'
import type { FireflyBudgetDraft } from '@/pages/imports/firefly/types'
import {
  FIREFLY_BUDGET_MIXED_CURRENCIES_REASON,
  FIREFLY_BUDGET_NO_CATEGORIES_REASON,
  FIREFLY_BUDGET_NO_LIMITS_REASON,
  FIREFLY_BUDGET_NO_TRANSACTIONS_REASON,
  FIREFLY_BUDGET_OVERLAPPING_PERIODS_REASON,
  FIREFLY_BUDGET_PERIOD_ENDS_BEFORE_START_REASON,
  FIREFLY_BUDGET_UNREADABLE_DATES_REASON,
  FIREFLY_BUDGET_UNSUPPORTED_CADENCE_REASON,
  getFireflyBudgetGroupCategoryReason,
  getFireflyBudgetUnsupportedCurrencyReason,
} from '@/pages/imports/firefly/constants'
import {
  buildFireflyBudgetDrafts,
  buildFireflyBudgetImportBudgets,
  findFireflyBudgetNamedInError,
} from '@/pages/imports/firefly/utils'

const CURRENCIES = [
  { id: 'CAD', minor_unit_exponent: 2 },
  { id: 'USD', minor_unit_exponent: 2 },
  { id: 'EUR', minor_unit_exponent: 2 },
  { id: 'JPY', minor_unit_exponent: 0 },
] as Currency[]

const MONTHLY_ON_THE_FIRST: FireflyBudgetImportRecurrence = { freq: 'monthly', instance_length: 1, weekday: null, dom: 1, month: null }

/**
 * Builds budget drafts against the supported currencies, with every category left unmatched
 * unless a test says otherwise
 */
function buildDrafts(input: Pick<Parameters<typeof buildFireflyBudgetDrafts>[0], 'budgetsFile' | 'transactionRows'>
  & Partial<Parameters<typeof buildFireflyBudgetDrafts>[0]>) {
  return buildFireflyBudgetDrafts({ currencies: CURRENCIES, categoryMappings: {}, categoryById: new Map(), ...input })
}

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
    amount: '600.000000000000',
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

    const [draft] = buildDrafts({
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

    const drafts = buildDrafts({
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

    const [draft] = buildDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
    })

    expect(draft.isArchived).toBe(true)
  })

  // Being archived no longer settles a budget on its own, so it must still
  // fall through to another skip reason when one applies
  it('skips an archived budget for another reason when one applies', () => {
    const budgetsFile = createBudgetsFile([createLimitRow({ active: '0' })])

    const [draft] = buildDrafts({
      budgetsFile,
      transactionRows: [],
    })

    expect(draft.isArchived).toBe(true)
    expect(draft.disabledReason).toBe(FIREFLY_BUDGET_NO_TRANSACTIONS_REASON)
  })

  it('derives a sorted limit period schedule and displays the latest amount', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow({ start_date: '2025-01-01', end_date: '2025-01-31', amount: '650.000000000000' }),
      createLimitRow({ start_date: '2024-01-01', end_date: '2024-01-31', amount: '600.000000000000' }),
      createLimitRow({ start_date: '2024-06-01', end_date: '2024-06-30', amount: '625.000000000000' }),
    ])

    const [draft] = buildDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
    })

    expect(draft.limits).toEqual([
      { start: '2024-01-01', end: '2024-01-31', amount: '600.000000000000' },
      { start: '2024-06-01', end: '2024-06-30', amount: '625.000000000000' },
      { start: '2025-01-01', end: '2025-01-31', amount: '650.000000000000' },
    ])
    expect(draft.amount).toBe('650.000000000000')
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

    const drafts = buildDrafts({ budgetsFile, transactionRows })

    const byName = Object.fromEntries(drafts.map((draft) => [draft.name, draft]))
    expect(byName.Entertainment.periodLabel).toBe('Quarterly')
    expect(byName.Clothing.periodLabel).toBe('Every 6 mths')
    expect(byName.Giving.periodLabel).toBe('Yearly')
    expect(byName.Fitness.periodLabel).toBe('Weekly')
    expect(byName.Trip.periodLabel).toBe('Not recurring')
    for (const draft of drafts) expect(draft.disabledReason).toBeNull()
  })

  it('disables a budget repeating on a period length no cadence expresses', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow({ start_date: '2025-03-01', end_date: '2025-03-13', amount: '45.000000000000' }),
      createLimitRow({ start_date: '2025-03-14', end_date: '2025-03-26', amount: '45.000000000000' }),
    ])

    const [draft] = buildDrafts({
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

    const [draft] = buildDrafts({
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
      createLimitRow({ currency_code: 'CAD', amount: '100.000000000000' }),
      createLimitRow({ currency_code: 'USD', amount: '100.000000000000' }),
    ])

    const [draft] = buildDrafts({
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

    const [draft] = buildDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
    })

    expect(draft.currencyCodes).toEqual(['CAD', 'USD'])
    expect(draft.disabledReason).toBe(FIREFLY_BUDGET_MIXED_CURRENCIES_REASON)
  })

  it('collapses exact duplicate limit rows to one schedule entry', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow({ start_date: '2024-01-01', amount: '600.000000000000' }),
      createLimitRow({ start_date: '2024-01-01', amount: '600.000000000000' }),
      createLimitRow({ start_date: '2024-06-01', end_date: '2024-06-30', amount: '625.000000000000' }),
    ])

    const [draft] = buildDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
    })

    expect(draft.limits).toEqual([
      { start: '2024-01-01', end: '2024-01-31', amount: '600.000000000000' },
      { start: '2024-06-01', end: '2024-06-30', amount: '625.000000000000' },
    ])
  })

  it('disables a budget with conflicting amounts over the same period as overlapping', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow({ start_date: '2024-01-01', amount: '600.000000000000' }),
      createLimitRow({ start_date: '2024-01-01', amount: '700.000000000000' }),
    ])

    const [draft] = buildDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
    })

    expect(draft.limits).toEqual([
      { start: '2024-01-01', end: '2024-01-31', amount: '600.000000000000' },
      { start: '2024-01-01', end: '2024-01-31', amount: '700.000000000000' },
    ])
    expect(draft.disabledReason).toBe(FIREFLY_BUDGET_OVERLAPPING_PERIODS_REASON)
  })

  it('drops limit rows missing a date, amount, or currency from the schedule', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow({ start_date: '', amount: '500.000000000000' }),
      createLimitRow({ start_date: '2024-01-01', amount: '' }),
      createLimitRow({ start_date: '2024-03-01', end_date: '', amount: '610.000000000000' }),
      createLimitRow({ start_date: '2024-05-01', end_date: '2024-05-31', currency_code: '', amount: '615.000000000000' }),
      createLimitRow({ start_date: '2024-06-01', end_date: '2024-06-30', amount: '625.000000000000' }),
    ])

    const [draft] = buildDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
    })

    expect(draft.limits).toEqual([{ start: '2024-06-01', end: '2024-06-30', amount: '625.000000000000' }])
    expect(draft.amount).toBe('625.000000000000')
  })

  // A well-shaped date naming no real day marks the file as corrupted, so
  // the budget is refused before upload instead of failing on the backend
  it('disables a budget whose limit dates name no real calendar day', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow(),
      createLimitRow({ start_date: '2024-02-31', end_date: '2024-03-30' }),
    ])

    const [draft] = buildDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
    })

    expect(draft.disabledReason).toBe(FIREFLY_BUDGET_UNREADABLE_DATES_REASON)
  })

  // The displayed currency comes off the schedule the export rows were cleaned into, so a row the
  // cleaning refused cannot decide it however late its unreadable date would have sorted
  it('takes the displayed currency from the latest period in the schedule', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow({ start_date: '2024-01-01', end_date: '2024-01-31' }),
      createLimitRow({ start_date: '2025-02-31', end_date: '2025-03-31', currency_code: 'USD' }),
    ])

    const [draft] = buildDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
    })

    expect(draft.currencyCode).toBe('CAD')
    expect(draft.currencyCodes).toEqual(['CAD'])
  })

  it('disables a budget whose export rows cannot form a limit schedule', () => {
    const budgetsFile = createBudgetsFile([
      createLimitRow({ start_date: '', amount: '' }),
    ])

    const [draft] = buildDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow()],
    })

    expect(draft.limits).toEqual([])
    expect(draft.disabledReason).toBe(FIREFLY_BUDGET_NO_LIMITS_REASON)
  })

  it('disables a budget no imported transaction references', () => {
    const budgetsFile = createBudgetsFile([createLimitRow()])

    const [draft] = buildDrafts({
      budgetsFile,
      transactionRows: [],
    })

    expect(draft.disabledReason).toBe(FIREFLY_BUDGET_NO_TRANSACTIONS_REASON)
  })

  // A row dropped before upload never registers its category as an import
  // source, so it cannot back a budget the commit would then fail to resolve
  it('ignores transaction rows the payload build drops', () => {
    const budgetsFile = createBudgetsFile([createLimitRow()])

    const drafts = buildDrafts({
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

    const [draft] = buildDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow({ category: '' })],
    })

    expect(draft.categoryNames).toEqual([])
    expect(draft.disabledReason).toBe(FIREFLY_BUDGET_NO_CATEGORIES_REASON)
  })

  it('collects the distinct sorted categories referencing a budget', () => {
    const budgetsFile = createBudgetsFile([createLimitRow()])

    const [draft] = buildDrafts({
      budgetsFile,
      transactionRows: [
        createTransactionRow({ category: 'Restaurants' }),
        createTransactionRow({ category: 'Food' }),
        createTransactionRow({ category: 'Food' }),
      ],
    })

    expect(draft.categoryNames).toEqual(['Food', 'Restaurants'])
  })

  // The budget upload is all or nothing, so each budget the backend would refuse is skipped with
  // its reason and the rest of the export still imports
  it.each<[string, CsvRow[], string]>([
    [
      'limit periods that overlap',
      [
        createLimitRow({ start_date: '2024-01-01', end_date: '2024-01-31', amount: '600.000000000000' }),
        createLimitRow({ start_date: '2024-01-15', end_date: '2024-02-14', amount: '700.000000000000' }),
      ],
      FIREFLY_BUDGET_OVERLAPPING_PERIODS_REASON,
    ],
    [
      'a custom Firefly III currency',
      [createLimitRow({ currency_code: 'USDT' })],
      getFireflyBudgetUnsupportedCurrencyReason('USDT'),
    ],
    [
      'a three-letter currency Lumina Finance does not have',
      [createLimitRow({ currency_code: 'ZZZ' })],
      getFireflyBudgetUnsupportedCurrencyReason('ZZZ'),
    ],
    [
      'an amount more precise than its currency',
      [createLimitRow({ currency_code: 'EUR', amount: '100.555000000000' })],
      'Its limit amount 100.555000000000 EUR has more than 2 decimal places',
    ],
    [
      'decimal places in a currency without them',
      [createLimitRow({ currency_code: 'JPY', amount: '1000.500000000000' })],
      'Its limit amount 1000.500000000000 JPY has decimal places the currency does not use',
    ],
    [
      'an amount too large to store',
      [createLimitRow({ amount: '92233720368547758.080000000000' })],
      'Its limit amount 92233720368547758.080000000000 CAD is too large to store',
    ],
    [
      'a zero amount',
      [createLimitRow({ amount: '0.000000000000' })],
      'Its limit amount 0.000000000000 CAD is not above zero',
    ],
    [
      'a period ending before it starts',
      [createLimitRow({ start_date: '2024-01-31', end_date: '2024-01-01' })],
      FIREFLY_BUDGET_PERIOD_ENDS_BEFORE_START_REASON,
    ],
  ])('skips a budget with %s and keeps the rest', (_, groceriesRows, reason) => {
    const budgetsFile = createBudgetsFile([...groceriesRows, createLimitRow({ name: 'Rent' })])

    const drafts = buildDrafts({
      budgetsFile,
      transactionRows: [createTransactionRow(), createTransactionRow({ budget: 'Rent', category: 'Housing' })],
    })

    const byName = Object.fromEntries(drafts.map((draft) => [draft.name, draft]))
    expect(byName.Groceries.disabledReason).toBe(reason)
    expect(byName.Rent.disabledReason).toBeNull()
  })

  // The backend checks the sent cadence against the latest period, and
  // backend/tests/routes/transactions/test_firefly_budget_imports.py runs the same cases, so a budget
  // shown recurring here is one the backend stores recurring
  it.each<[string, CsvRow[], FireflyBudgetImportRecurrence | null, string]>([
    [
      'quarterly after monthly',
      [
        createLimitRow({ start_date: '2025-12-01', end_date: '2025-12-31' }),
        createLimitRow({ start_date: '2026-01-01', end_date: '2026-03-31' }),
      ],
      { freq: 'monthly', instance_length: 3, weekday: null, dom: 1, month: null },
      'Quarterly',
    ],
    [
      'yearly',
      [
        createLimitRow({ start_date: '2024-01-01', end_date: '2024-12-31' }),
        createLimitRow({ start_date: '2025-01-01', end_date: '2025-12-31' }),
      ],
      { freq: 'yearly', instance_length: 1, weekday: null, dom: 1, month: 1 },
      'Yearly',
    ],
    [
      'weekly from Monday',
      [
        createLimitRow({ start_date: '2026-01-05', end_date: '2026-01-11' }),
        createLimitRow({ start_date: '2026-01-12', end_date: '2026-01-18' }),
      ],
      { freq: 'weekly', instance_length: 1, weekday: 0, dom: null, month: null },
      'Weekly',
    ],
    [
      'mid-month anchor',
      [createLimitRow({ start_date: '2026-01-15', end_date: '2026-02-14' })],
      { freq: 'monthly', instance_length: 1, weekday: null, dom: 15, month: null },
      'Monthly',
    ],
    [
      'day-31 anchor capped in February',
      [createLimitRow({ start_date: '2026-02-28', end_date: '2026-03-30' })],
      { freq: 'monthly', instance_length: 1, weekday: null, dom: 31, month: null },
      'Monthly',
    ],
    [
      'quarter from November 30 is 13 weeks',
      [createLimitRow({ start_date: '2025-11-30', end_date: '2026-02-28' })],
      { freq: 'weekly', instance_length: 13, weekday: 6, dom: null, month: null },
      'Every 13 wks',
    ],
    [
      'monthly then May 1 to 20 is not recurring',
      [
        createLimitRow({ start_date: '2026-02-01', end_date: '2026-02-28' }),
        createLimitRow({ start_date: '2026-03-01', end_date: '2026-03-31' }),
        createLimitRow({ start_date: '2026-04-01', end_date: '2026-04-30' }),
        createLimitRow({ start_date: '2026-05-01', end_date: '2026-05-20' }),
      ],
      null,
      'Not recurring',
    ],
  ])('reads the cadence off the latest period: %s', (_, rows, recurrence, label) => {
    const [draft] = buildDrafts({ budgetsFile: createBudgetsFile(rows), transactionRows: [createTransactionRow()] })

    expect(draft.disabledReason).toBeNull()
    expect(draft.recurrence).toEqual(recurrence)
    expect(draft.periodLabel).toBe(label)
  })

  // Firefly III writes one budgets row per limit, so a budget without limits is absent from the file
  // The missing limits are the cause even when the transactions carry no category, and a budget
  // only rows dropped before upload name is not listed at all
  it('lists a budget the transactions name but the budgets file lacks as having no limit periods', () => {
    const drafts = buildDrafts({
      budgetsFile: createBudgetsFile([createLimitRow()]),
      transactionRows: [
        createTransactionRow(),
        createTransactionRow({ budget: 'Holiday', category: 'Travel' }),
        createTransactionRow({ budget: 'Gifts', category: '' }),
        createTransactionRow({ journal_id: '', budget: 'Gym' }),
      ],
    })

    expect(drafts.map((draft) => [draft.name, draft.disabledReason])).toEqual([
      ['Gifts', FIREFLY_BUDGET_NO_LIMITS_REASON],
      ['Groceries', null],
      ['Holiday', FIREFLY_BUDGET_NO_LIMITS_REASON],
    ])
  })

  // The backend measures names in code points, where an emoji is one character, not two
  it('takes a budget name of 256 characters and skips one of 257', () => {
    const atLimit = '🛒'.repeat(256)
    const pastLimit = '🧾'.repeat(257)

    const drafts = buildDrafts({
      budgetsFile: createBudgetsFile([createLimitRow({ name: atLimit }), createLimitRow({ name: pastLimit })]),
      transactionRows: [createTransactionRow({ budget: atLimit }), createTransactionRow({ budget: pastLimit })],
    })

    const byName = Object.fromEntries(drafts.map((draft) => [draft.name, draft]))
    expect(byName[atLimit].disabledReason).toBeNull()
    expect(byName[pastLimit].disabledReason).toBe('Its name length is 257, and the importer takes up to 256')
  })

  // An imported budget is the user's own, and the budget import takes only their own and built-in
  // categories, so one matched to a group's category would fail every budget with it
  it('skips a budget whose category is matched to a group category and keeps one matched to the user\'s own', () => {
    const familyFood = { id: 'family-food', name: 'Food', kind: 'expense', group_id: 'family', is_system: false } as Category
    const housing = { id: 'housing', name: 'Housing', kind: 'expense', group_id: null, is_system: false } as Category

    const drafts = buildDrafts({
      budgetsFile: createBudgetsFile([createLimitRow(), createLimitRow({ name: 'Rent' })]),
      transactionRows: [createTransactionRow(), createTransactionRow({ budget: 'Rent', category: 'Housing' })],
      categoryMappings: { Food: familyFood.id, Housing: housing.id },
      categoryById: new Map([[familyFood.id, familyFood], [housing.id, housing]]),
    })

    const byName = Object.fromEntries(drafts.map((draft) => [draft.name, draft]))
    expect(byName.Groceries.disabledReason).toBe(getFireflyBudgetGroupCategoryReason('Food'))
    expect(byName.Rent.disabledReason).toBeNull()
  })
})

// This covers the matching the workflow hook calls when the budget upload fails
describe('findFireflyBudgetNamedInError', () => {
  it('puts an error on the budget it names when another budget\'s name starts it', () => {
    const names = ['Car', 'Car insurance']

    expect(findFireflyBudgetNamedInError(names, 'Car insurance: two limit periods overlap')).toBe('Car insurance')
    expect(findFireflyBudgetNamedInError(names, 'Car: two limit periods overlap')).toBe('Car')
    expect(findFireflyBudgetNamedInError(names, 'Cars: two limit periods overlap')).toBeUndefined()
  })
})

describe('buildFireflyBudgetImportBudgets', () => {
  it('trims exported limit amounts before sending the budget payload', () => {
    const drafts = buildDrafts({
      budgetsFile: createBudgetsFile([createLimitRow({ amount: ' \t600.00\n' })]),
      transactionRows: [createTransactionRow()],
    })
    const [budget] = buildFireflyBudgetImportBudgets(drafts, { Food: 'category-food' })

    expect(drafts[0].disabledReason).toBeNull()
    expect(budget.limits).toEqual([
      { start: '2024-01-01', end: '2024-01-31', amount: '600.00' },
    ])
  })

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
      recurrence: MONTHLY_ON_THE_FIRST,
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
      recurrence: MONTHLY_ON_THE_FIRST,
      is_archived: false,
    })
  })

  // The backend requires the cadence on every budget, so a budget that does not recur sends null
  it('sends a null cadence for a budget that does not recur', () => {
    const [budget] = buildFireflyBudgetImportBudgets([createDraft({ recurrence: null })], {})

    expect(budget).toHaveProperty('recurrence', null)
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
