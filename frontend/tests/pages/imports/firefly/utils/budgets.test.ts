/**
 * Tests Firefly III budget draft derivation and the budgets an import run stages
 *
 * Formatted amounts such as 'CA$650.00' assume the en-US locale the test script sets with LC_ALL
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { FireflyBudgetImportRecurrence } from '@/api/firefly-imports'
import type { CsvRow, ImportFileDraft } from '@/pages/imports/types'
import type { FireflyBudgetDraft } from '@/pages/imports/firefly/types'
import { CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
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
  type FireflyRowResolutionOptions,
  buildFireflyBudgetDrafts,
  buildFireflyBudgetCountingNotes,
  buildFireflyRunBudgets,
} from '@/pages/imports/firefly/utils'
import { createNameKeyedAccountSources } from './fixtures'

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
    amount: '-25.000000000000',
    currency_code: 'CAD',
    source_name: 'Chequing',
    source_type: 'Asset account',
    destination_name: 'Market',
    destination_type: 'Expense account',
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
    // Firefly III writes limits with twelve decimal places, which show as a normal amount
    expect(draft.amount).toBe('CA$650.00')
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
    expect(draft.amount).toBe('CA$625.00')
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

  // A transfer takes Transfer and a balance row Balance Adjustment, so the category Firefly III
  // gave either is never created and a budget tracking it would reach the commit with none
  it('disables a budget whose categorised rows are all transfers or balance rows', () => {
    const budgetsFile = createBudgetsFile([createLimitRow()])

    const [draft] = buildDrafts({
      budgetsFile,
      transactionRows: [
        createTransactionRow({
          type: 'Transfer',
          amount: '500.000000000000',
          category: 'Savings plan',
          destination_name: 'Savings',
          destination_type: 'Asset account',
        }),
        createTransactionRow({
          journal_id: '2',
          type: 'Opening balance',
          amount: '1000.000000000000',
          category: 'Starting funds',
          source_name: 'Initial balance for "Chequing"',
          source_type: 'Initial balance account',
          destination_name: 'Chequing',
          destination_type: 'Asset account',
        }),
      ],
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

// Firefly III gives each transaction one budget, while a Lumina budget counts whole categories
describe('how imported Firefly budgets will count spending', () => {
  const chequing = { id: 'chequing', name: 'Chequing', currency: 'CAD', institution: null, can_write: true, is_archived: false } as AccountsOverview
  const wallet = { id: 'wallet', name: 'Euro Wallet', currency: 'EUR', institution: null, can_write: true, is_archived: false } as AccountsOverview
  const restaurants = { id: 'restaurants', name: 'Restaurants', kind: 'expense', group_id: null, is_system: false } as Category
  const travel = { id: 'travel', name: 'Travel', kind: 'expense', group_id: null, is_system: false } as Category
  const housing = { id: 'housing', name: 'Housing', kind: 'expense', group_id: null, is_system: false } as Category
  const miscellaneous = { id: 'miscellaneous', name: 'Miscellaneous', kind: 'expense', group_id: null, is_system: true } as Category
  const carLoan = { id: 'car-loan', name: 'Car Loan', currency: 'CAD', institution: null, can_write: true, is_archived: false } as AccountsOverview

  /**
   * Resolution options with both accounts mapped and the export's categories matched, the two
   * Firefly names for eating out merged into one Lumina category
   */
  function createOptions(categoryMappings: Record<string, string> = {}): FireflyRowResolutionOptions {
    return {
      accountSources: createNameKeyedAccountSources(['Chequing', 'Euro Wallet', 'Car Loan']),
      accountById: new Map([[chequing.id, chequing], [wallet.id, wallet], [carLoan.id, carLoan]]),
      accountMappings: { Chequing: chequing.id, 'Euro Wallet': wallet.id, 'Car Loan': carLoan.id },
      accountCreateDetails: {},
      institutionById: new Map(),
      categoryById: new Map([restaurants, travel, housing, miscellaneous].map((category) => [category.id, category])),
      categoryMappings: {
        Restaurants: restaurants.id,
        'Eating Out': restaurants.id,
        Travel: travel.id,
        Housing: housing.id,
        '(no category)': miscellaneous.id,
        ...categoryMappings,
      },
      categoryCreateKinds: {},
      transferCategory: undefined,
      balanceAdjustmentCategory: undefined,
      currencies: CURRENCIES,
    }
  }

  const payee = (destination_name: string, source_name = 'Chequing') => ({
    source_name,
    source_type: 'Asset account',
    destination_name,
    destination_type: 'Expense account',
  })
  const budgetsFile = createBudgetsFile([
    createLimitRow({ name: 'Food' }),
    createLimitRow({ name: 'Holiday' }),
    createLimitRow({ name: 'Rent' }),

    // Overlapping limits skip this budget, so it shares nothing even while still selected
    createLimitRow({ name: 'Dining', start_date: '2024-01-01', end_date: '2024-01-31' }),
    createLimitRow({ name: 'Dining', start_date: '2024-01-15', end_date: '2024-02-14' }),
  ])
  const transactionRows = [
    createTransactionRow({ journal_id: '1', budget: 'Food', category: 'Restaurants', ...payee('Bistro') }),
    createTransactionRow({ journal_id: '2', budget: 'Holiday', category: 'Eating Out', ...payee('Trattoria') }),
    createTransactionRow({ journal_id: '3', budget: 'Holiday', category: 'Travel', ...payee('Airline') }),
    createTransactionRow({ journal_id: '4', budget: 'Rent', category: 'Housing', ...payee('Landlord') }),
    createTransactionRow({ journal_id: '5', budget: 'Dining', category: 'Restaurants', ...payee('Diner') }),
  ]

  // Food and Holiday name different Firefly categories, which both become Restaurants
  it('names the Lumina categories a selected budget shares with another selected budget', () => {
    const drafts = buildDrafts({ budgetsFile, transactionRows })
    const build = (selected: string[]) => buildFireflyBudgetCountingNotes({
      drafts,
      selectedNames: new Set(selected),
      rows: transactionRows,
      options: createOptions(),
    })

    expect(build(['Food', 'Holiday', 'Rent', 'Dining'])).toEqual([
      "Food shares Restaurants with Holiday, so it also counts Holiday's spending in Restaurants.",
      "Holiday shares Restaurants with Food, so it also counts Food's spending in Restaurants.",
    ])

    // A budget left out of the import shares nothing with the ones going in
    expect(build(['Food', 'Rent'])).toEqual([])
  })

  // A new category takes over an existing one of the same name, and new names differing only in
  // capitals become one category
  it.each([
    {
      case: 'a new category named like an existing one',
      holidayCategory: 'restaurants',
      rentCategory: 'Housing',
      created: ['restaurants'],
      expected: [
        "Food shares Restaurants with Holiday, so it also counts Holiday's spending in Restaurants.",
        "Holiday shares Restaurants with Food, so it also counts Food's spending in Restaurants.",
      ],
    },
    {
      case: 'two new categories differing only in capitals',
      holidayCategory: 'Coffee',
      rentCategory: 'COFFEE',
      created: ['Coffee', 'COFFEE'],
      expected: [
        "Holiday shares Coffee with Rent, so it also counts Rent's spending in Coffee.",
        "Rent shares COFFEE with Holiday, so it also counts Holiday's spending in COFFEE.",
      ],
    },
  ])('matches $case as one category', ({ holidayCategory, rentCategory, created, expected }) => {
    const rows = [
      createTransactionRow({ journal_id: '1', budget: 'Food', category: 'Restaurants', ...payee('Bistro') }),
      createTransactionRow({ journal_id: '2', budget: 'Holiday', category: holidayCategory, ...payee('Café') }),
      createTransactionRow({ journal_id: '3', budget: 'Rent', category: rentCategory, ...payee('Roastery') }),
    ]

    expect(buildFireflyBudgetCountingNotes({
      drafts: buildDrafts({ budgetsFile, transactionRows: rows }),
      selectedNames: new Set(['Food', 'Holiday', 'Rent']),
      rows,
      options: createOptions(Object.fromEntries(created.map((name) => [name, CREATE_CATEGORY_VALUE]))),
    })).toEqual(expected)
  })

  it('totals the budgeted spending with no category as each row will import', () => {
    const rows = [
      ...transactionRows,
      createTransactionRow({ journal_id: '6', budget: 'Food', category: '', amount: '-3.000000000000', currency_code: 'EUR', ...payee('Café', 'Euro Wallet') }),
      createTransactionRow({ journal_id: '7', budget: 'Food', category: '', amount: '-12.500000000000', ...payee('Market') }),

      // Written in its foreign amount, the one in the account's currency
      createTransactionRow({
        journal_id: '8',
        budget: 'Food',
        category: '',
        amount: '-5.000000000000',
        currency_code: 'USD',
        foreign_amount: '-7.250000000000',
        foreign_currency_code: 'CAD',
        ...payee('Kiosk'),
      }),

      // Neither amount is in the account's currency, so the import skips this row
      createTransactionRow({ journal_id: '9', budget: 'Food', category: '', amount: '-40.000000000000', currency_code: 'USD', ...payee('Pub') }),

      // A payment to a loan imports as a transfer, which no budget counts
      createTransactionRow({
        journal_id: '10',
        budget: 'Holiday',
        category: '',
        amount: '-100.000000000000',
        source_name: 'Chequing',
        source_type: 'Asset account',
        destination_name: 'Car Loan',
        destination_type: 'Loan',
      }),
    ]
    const drafts = buildDrafts({ budgetsFile, transactionRows: rows })

    expect(buildFireflyBudgetCountingNotes({
      drafts,
      selectedNames: new Set(['Food', 'Holiday']),
      rows,
      options: createOptions(),
    })).toContain('Food has CA$19.75 and €3.00 of spending with no category in Firefly III, which it will not count.')
    expect(buildFireflyBudgetCountingNotes({
      drafts,
      selectedNames: new Set(['Holiday']),
      rows,
      options: createOptions(),
    })).toEqual([])

    // Once rows with no category become a category Food tracks, Food counts them after all
    expect(buildFireflyBudgetCountingNotes({
      drafts,
      selectedNames: new Set(['Food']),
      rows,
      options: createOptions({ '(no category)': restaurants.id }),
    })).toEqual([])
  })

  it('shows a limit in its currency\'s format, or as exported when the currency cannot read it', () => {
    const drafts = buildDrafts({
      budgetsFile: createBudgetsFile([
        createLimitRow({ name: 'Groceries', currency_code: 'JPY', amount: '5000.000000000000' }),
        createLimitRow({ name: 'Crypto', currency_code: 'USDT', amount: '600.000000000000' }),
        createLimitRow({ name: 'Travel', currency_code: 'EUR', amount: '100.555000000000' }),
      ]),
      transactionRows: [
        createTransactionRow(),
        createTransactionRow({ budget: 'Crypto' }),
        createTransactionRow({ budget: 'Travel' }),
      ],
    })

    expect(drafts.map((draft) => [draft.name, draft.amount])).toEqual([
      ['Crypto', '600.000000000000 USDT'],
      ['Groceries', '¥5,000'],
      ['Travel', '100.555000000000 EUR'],
    ])
  })
})

describe('buildFireflyRunBudgets', () => {
  const FOOD = { source: 'Food', create: { name: 'Food', kind: 'expense' as const } }
  const RESTAURANTS = { source: 'Restaurants', category_id: 'category-restaurants' }
  const RENT = { source: 'Rent', category_id: 'category-rent' }

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

  it('trims exported limit amounts before staging the budget', () => {
    const drafts = buildDrafts({
      budgetsFile: createBudgetsFile([createLimitRow({ amount: ' \t600.00\n' })]),
      transactionRows: [createTransactionRow()],
    })
    const { budgets: [budget] } = buildFireflyRunBudgets(drafts, [FOOD])

    expect(drafts[0].disabledReason).toBeNull()
    expect(budget.limits).toEqual([
      { start: '2024-01-01', end: '2024-01-31', amount: '600.00' },
    ])
  })

  // The commit resolves the sources against the run's mappings, so the budgets carry the mapping of
  // every category they name, and only those
  it('names categories by source and carries only the mappings the budgets use', () => {
    const result = buildFireflyRunBudgets(
      [
        createDraft({ categoryNames: ['Food', 'Restaurants'] }),
        createDraft({ name: 'Eating out', categoryNames: ['Restaurants'], recurrence: null, isArchived: true }),
      ],
      [FOOD, RESTAURANTS, RENT],
    )

    expect(result).toEqual({
      categories: [FOOD, RESTAURANTS],
      budgets: [
        {
          name: 'Groceries',
          currency: 'CAD',
          category_sources: ['Food', 'Restaurants'],
          limits: [{ start: '2024-01-01', end: '2024-01-31', amount: '600.00' }],
          recurrence: MONTHLY_ON_THE_FIRST,
          is_archived: false,
        },
        {
          name: 'Eating out',
          currency: 'CAD',
          category_sources: ['Restaurants'],
          limits: [{ start: '2024-01-01', end: '2024-01-31', amount: '600.00' }],
          recurrence: null,
          is_archived: true,
        },
      ],
    })
  })

  it('refuses a budget naming a category the import does not map, naming the budget', () => {
    expect(() => buildFireflyRunBudgets([createDraft({ categoryNames: ['Food', 'Travel'] })], [FOOD]))
      .toThrow('Groceries: category Travel is not mapped')
  })
})
