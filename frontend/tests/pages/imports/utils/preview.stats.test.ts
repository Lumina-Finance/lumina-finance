/**
 * Tests the CSV import's summary figures, the same four every import's preview opens with, read off
 * the import the commit would send
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import { CREATE_ACCOUNT_VALUE, CREATE_CATEGORY_VALUE, EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import type { CsvRow, ImportAccountSource, ImportFileDraft } from '@/pages/imports/types'
import { buildTransactionImportPayload, getCsvImportStats } from '@/pages/imports/utils'

const CURRENCIES: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
]

const CHEQUING: AccountsOverview = {
  id: 'chequing',
  owner_id: 'user-1',
  group_id: null,
  account_kind: 'asset',
  account_type: 'checking',
  tax_advantaged_category_id: null,
  name: 'Chequing',
  institution: null,
  currency: 'CAD',
  current_balance: 0,
  base_currency_current_balance: 0,
  current_balance_fx_status: { state: 'complete', missing_pairs: [] },
  credit_limit: null,
  can_write: true,
  is_archived: false,
}

const GROCERIES: Category = {
  id: 'groceries',
  group_id: null,
  owner_id: 'user-1',
  name: 'Groceries',
  kind: 'expense',
  icon: null,
  is_system: false,
  created_at: '2026-01-01T00:00:00Z',
}

// A category an earlier import created, which a file naming it again reuses rather than creating twice
const HOBBY_SUPPLIES: Category = { ...GROCERIES, id: 'hobby-supplies', name: 'Hobby supplies' }

// A name the user holds for income, which a new expense category of that name can't reuse
const PRESENTS: Category = { ...GROCERIES, id: 'presents', name: 'Presents', kind: 'income' }

const HEADERS = ['Date', 'Account', 'Category', 'Amount']

/**
 * Creates a one-file import of the given rows, each written to an account and filed under a category
 */
function createFile(rows: CsvRow[]): ImportFileDraft {
  return { id: 'file-1', name: 'export.csv', size: 512, headers: HEADERS, hasHeaderRow: true, rows, error: null }
}

/**
 * Creates `count` rows, cycling through the accounts and categories given
 */
function createRows(count: number, accounts: string[], categories: string[], amount = '-40.00'): CsvRow[] {
  return Array.from({ length: count }, (_, index) => ({
    Date: '2026-04-11',
    Account: accounts[index % accounts.length],
    Category: categories[index % categories.length],
    Amount: amount,
  }))
}

/**
 * Builds the import for the rows and answers given, and reads its summary the way the preview does
 */
function summarize(rows: CsvRow[], accountMappings: Record<string, string>, categoryMappings: Record<string, string>) {
  const accountSources: ImportAccountSource[] = Object.keys(accountMappings).map((source) => ({
    id: source,
    label: source,
    matchText: source,
    isCounterpartyOnly: false,
  }))
  const importedCategories = Object.keys(categoryMappings)
  const newAccounts = Object.keys(accountMappings).filter((source) => accountMappings[source] === CREATE_ACCOUNT_VALUE)
  const newCategories = importedCategories.filter((source) => categoryMappings[source] === CREATE_CATEGORY_VALUE)
  const categoryById = new Map([GROCERIES, HOBBY_SUPPLIES, PRESENTS].map((category) => [category.id, category]))
  const categoryCreateKinds = Object.fromEntries(newCategories.map((source) => [source, 'expense' as const]))
  const importBuild = buildTransactionImportPayload({
    accountById: new Map([[CHEQUING.id, CHEQUING]]),
    accountCreateCurrencies: Object.fromEntries(newAccounts.map((source) => [source, 'CAD'])),
    accountCreateInstitutions: {},
    accountCreateTypes: Object.fromEntries(newAccounts.map((source) => [source, 'checking'])),
    accountMappings,
    accountSources,
    categoryById,
    categoryCreateKinds,
    categoryMappings,
    categoryTypesBySource: {},
    columnMap: { ...EMPTY_COLUMN_MAP, dt: 'Date', account_id: 'Account', category_id: 'Category', amount: 'Amount' },
    columnValidationErrors: {},
    currencies: CURRENCIES,
    dateFormat: 'yearFirst',
    directionAnswers: {},
    files: [createFile(rows)],
    importedCategories,
  })

  return {
    importBuild,
    stats: getCsvImportStats({
      rowCount: rows.length,
      importBuild,
      accountSources,
      accountMappings,
      importedCategories,
      categoryMappings,
      categoryById,
      categoryCreateKinds,
      categoryRenames: {},
      categoryTypesBySource: {},
    }),
  }
}

describe('the CSV import summary', () => {
  it('counts every row, the transactions it creates and each new account and category', () => {
    const rows = createRows(120, ['Visa', 'Savings'], ['Dining', 'Fuel', 'Gifts'])

    const { importBuild, stats } = summarize(
      rows,
      { Visa: CREATE_ACCOUNT_VALUE, Savings: CREATE_ACCOUNT_VALUE },
      { Dining: CREATE_CATEGORY_VALUE, Fuel: CREATE_CATEGORY_VALUE, Gifts: CREATE_CATEGORY_VALUE },
    )

    expect(importBuild.errors).toEqual([])
    expect(stats).toEqual({ rowCount: 120, transactionEstimate: 120, newAccountCount: 2, newCategoryCount: 3 })
  })

  it('counts no new account or category when every value matches one the user has', () => {
    const rows = createRows(12, ['Chequing'], ['Groceries'])

    const { stats } = summarize(rows, { Chequing: CHEQUING.id }, { Groceries: GROCERIES.id })

    expect(stats).toEqual({ rowCount: 12, transactionEstimate: 12, newAccountCount: 0, newCategoryCount: 0 })
  })

  // The upload sends only the answers its rows name, so a category only a left-out row names is never
  // sent and never created
  it('leaves the rows it can\'t import out of what it creates, including a category only they name', () => {
    const rows = [
      ...createRows(8, ['Chequing'], ['Groceries']),
      ...createRows(2, ['Chequing'], ['Dining'], 'forty'),
    ]

    const { importBuild, stats } = summarize(
      rows,
      { Chequing: CHEQUING.id },
      { Groceries: GROCERIES.id, Dining: CREATE_CATEGORY_VALUE },
    )

    expect(importBuild.rowProblems).toHaveLength(2)
    expect(stats).toEqual({ rowCount: 10, transactionEstimate: 8, newAccountCount: 0, newCategoryCount: 0 })
  })

  // The commit reuses a category the user already has under the same name, capitals folded, and
  // reports none created for it, which is what the preview has to say beforehand
  it('leaves out a new category whose name the user already has for the same type', () => {
    const rows = createRows(4, ['Chequing'], ['hobby supplies', 'Gardening'])

    const { importBuild, stats } = summarize(
      rows,
      { Chequing: CHEQUING.id },
      { 'hobby supplies': CREATE_CATEGORY_VALUE, Gardening: CREATE_CATEGORY_VALUE },
    )

    expect(importBuild.errors).toEqual([])
    expect(stats.newCategoryCount).toBe(1)
  })

  // Left without the other name the step proposes, so only its type tells it apart from the income
  // category that shares its name
  it('counts a new category whose name the user holds for another type', () => {
    const rows = createRows(2, ['Chequing'], ['Presents'])

    const { stats } = summarize(rows, { Chequing: CHEQUING.id }, { Presents: CREATE_CATEGORY_VALUE })

    expect(stats.newCategoryCount).toBe(1)
  })
})
