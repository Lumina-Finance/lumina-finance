/**
 * Tests CSV rows with no category, which are listed together as (no category), matched to
 * Miscellaneous and imported there unless the user matches them elsewhere. Those bringing money in are
 * listed as (money in, no category) and matched to Other Income, so income is never filed as spending,
 * and those naming a transfer account are listed as (transfer, no category) and matched to Transfer
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import { JOURNAL_NO_CATEGORY_SOURCE } from '@/api/provider-imports'
import {
  EMPTY_COLUMN_MAP,
  IMPORT_NO_CATEGORY_MONEY_IN_SOURCE,
  IMPORT_NO_CATEGORY_TRANSFER_SOURCE,
} from '@/pages/imports/constants'
import type { ColumnMap, CsvRow, ImportAmountDirection, ImportFileDraft } from '@/pages/imports/types'
import {
  buildTransactionImportPayload,
  getImportedCategories,
  getImportedCategoryTypes,
  getMissingRequiredColumnLabels,
  inferCategoryMappings,
  isColumnMappingComplete,
  validateColumnValues,
} from '@/pages/imports/utils'

const CURRENCIES: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
]

const MISCELLANEOUS: Category = {
  id: 'miscellaneous',
  group_id: null,
  owner_id: null,
  name: 'Miscellaneous',
  kind: 'expense',
  icon: null,
  is_system: true,
  created_at: '2026-01-01T00:00:00Z',
}

const GROCERIES: Category = {
  ...MISCELLANEOUS,
  id: 'groceries',
  owner_id: 'user-1',
  name: 'Groceries',
  is_system: false,
}

const TRANSFER: Category = {
  ...MISCELLANEOUS,
  id: 'transfer',
  name: 'Transfer',
  kind: 'transfer',
}

const OTHER_INCOME: Category = {
  ...MISCELLANEOUS,
  id: 'other-income',
  name: 'Other Income',
  kind: 'income',
}

const CATEGORIES = [MISCELLANEOUS, GROCERIES, TRANSFER, OTHER_INCOME]

const WITH_CATEGORY: ColumnMap = { ...EMPTY_COLUMN_MAP, dt: 'Date', category_id: 'Category', amount: 'Amount' }
const WITHOUT_CATEGORY: ColumnMap = { ...EMPTY_COLUMN_MAP, dt: 'Date', amount: 'Amount' }
const WITH_TRANSFER_ACCOUNT: ColumnMap = { ...WITH_CATEGORY, counterparty_account_id: 'Transfer Account' }

/**
 * Creates a one-file import of rows filed under the given categories, a blank one standing for a
 * row with no category, and naming the transfer accounts given beside them
 */
function createFile(categories: string[], transferAccounts: string[] = []): ImportFileDraft {
  const rows: CsvRow[] = categories.map((category, index) => ({
    Date: '2026-04-11',
    Category: category,
    Amount: '-40.00',
    'Transfer Account': transferAccounts[index] ?? '',
  }))
  const headers = ['Date', 'Category', 'Amount', 'Transfer Account']
  return { id: 'file-1', name: 'Chequing.csv', size: 512, headers, hasHeaderRow: true, rows, error: null }
}

/**
 * Lists the categories, matches them the way the category step does, and builds the import with the
 * user's own answers laid over the match
 */
function importFile(
  file: ImportFileDraft,
  columnMap: ColumnMap,
  answers: Record<string, string> = {},
  directionAnswers: Record<string, ImportAmountDirection> = {},
) {
  const importedCategories = getImportedCategories([file], columnMap, directionAnswers)
  const categoryMappings = inferCategoryMappings(importedCategories, answers, CATEGORIES)
  const build = buildTransactionImportPayload({
    accountById: new Map(),
    accountCreateCurrencies: {},
    accountCreateInstitutions: {},
    accountCreateTypes: {},
    accountMappings: { 'file-1': 'account-1', Savings: 'account-2' },
    accountSources: [
      { id: 'file-1', label: 'Chequing.csv', matchText: 'Chequing.csv', isCounterpartyOnly: false },
      { id: 'Savings', label: 'Savings', matchText: 'Savings', isCounterpartyOnly: true },
    ],
    categoryById: new Map(CATEGORIES.map((category) => [category.id, category])),
    categoryCreateKinds: {},
    categoryMappings,
    categoryTypesBySource: {},
    columnMap,
    columnValidationErrors: {},
    currencies: CURRENCIES,
    dateFormat: 'yearFirst',
    directionAnswers,
    files: [file],
    importedCategories,
  })
  return { importedCategories, categoryMappings, build }
}

/** Counts the rows the import sends under each category source */
function countRowsBySource(build: ReturnType<typeof importFile>['build']) {
  const counts: Record<string, number> = {}
  for (const row of build.payload?.rows ?? []) counts[row.category_source] = (counts[row.category_source] ?? 0) + 1
  return counts
}

describe('CSV rows with no category', () => {
  it('lists them as (no category), matched to Miscellaneous, and imports them there', () => {
    const file = createFile(['Groceries', '', 'Groceries', '', ' ', '', 'Groceries'])

    const { importedCategories, categoryMappings, build } = importFile(file, WITH_CATEGORY)

    expect(importedCategories).toEqual(['Groceries', JOURNAL_NO_CATEGORY_SOURCE])
    expect(categoryMappings[JOURNAL_NO_CATEGORY_SOURCE]).toBe(MISCELLANEOUS.id)
    expect(build.errors).toEqual([])
    expect(build.rowProblems).toEqual([])
    expect(countRowsBySource(build)).toEqual({ Groceries: 3, [JOURNAL_NO_CATEGORY_SOURCE]: 4 })
    expect(build.payload?.categories).toContainEqual({ source: JOURNAL_NO_CATEGORY_SOURCE, category_id: MISCELLANEOUS.id })
  })

  it('imports them into the category the user matches them to instead', () => {
    const file = createFile(['Groceries', '', '', '', ''])

    const { categoryMappings, build } = importFile(file, WITH_CATEGORY, { [JOURNAL_NO_CATEGORY_SOURCE]: GROCERIES.id })

    expect(categoryMappings[JOURNAL_NO_CATEGORY_SOURCE]).toBe(GROCERIES.id)
    expect(countRowsBySource(build)[JOURNAL_NO_CATEGORY_SOURCE]).toBe(4)
    expect(build.payload?.categories).toContainEqual({ source: JOURNAL_NO_CATEGORY_SOURCE, category_id: GROCERIES.id })
  })

  it('accepts a Category column with blank cells', () => {
    const file = createFile(['Groceries', ''])

    expect(validateColumnValues([file], 'Category', 'category_id', new Set(['CAD'])).valid).toBe(true)
  })

  it('reads the direction of the rows with no category from their amounts', () => {
    const file = createFile(['', ''])

    expect(getImportedCategoryTypes([file], WITH_CATEGORY, [JOURNAL_NO_CATEGORY_SOURCE], {})).toEqual({
      [JOURNAL_NO_CATEGORY_SOURCE]: 'Expense',
    })
  })
})

describe('CSV rows with no category that bring money in', () => {
  const DATED = { ...EMPTY_COLUMN_MAP, dt: 'Date' }

  // The same two rows, a coffee paid out and a salary paid in, written in each way a file can state
  // which way its money moved
  it.each<{
    arrangement: string
    columnMap: ColumnMap
    cells: CsvRow[]
    directionAnswers: Record<string, ImportAmountDirection>
  }>([
    {
      arrangement: 'a signed Amount column',
      columnMap: { ...DATED, amount: 'Amount' },
      cells: [{ Amount: '-4.50' }, { Amount: '3200.00' }],
      directionAnswers: {},
    },
    {
      arrangement: 'Money out and Money in columns',
      columnMap: { ...DATED, amount_out: 'Out', amount_in: 'In' },
      cells: [{ Out: '4.50', In: '' }, { Out: '', In: '3200.00' }],
      directionAnswers: {},
    },
    {
      arrangement: 'a Direction column',
      columnMap: { ...DATED, amount: 'Amount', amount_direction: 'Type' },
      cells: [{ Amount: '4.50', Type: 'DEBIT' }, { Amount: '3200.00', Type: 'CREDIT' }],
      directionAnswers: { debit: 'out', credit: 'in' },
    },
  ])('lists them as (money in, no category), matched to Other Income, from $arrangement', ({ columnMap, cells, directionAnswers }) => {
    const rows: CsvRow[] = cells.map((cell) => ({ Date: '2026-04-11', ...cell }))
    const file: ImportFileDraft = {
      id: 'file-1', name: 'Chequing.csv', size: 512, headers: Object.keys(rows[0]), hasHeaderRow: true, rows, error: null,
    }

    const { importedCategories, categoryMappings, build } = importFile(file, columnMap, {}, directionAnswers)

    expect(importedCategories).toEqual([JOURNAL_NO_CATEGORY_SOURCE, IMPORT_NO_CATEGORY_MONEY_IN_SOURCE])
    expect(categoryMappings[JOURNAL_NO_CATEGORY_SOURCE]).toBe(MISCELLANEOUS.id)
    expect(categoryMappings[IMPORT_NO_CATEGORY_MONEY_IN_SOURCE]).toBe(OTHER_INCOME.id)
    expect(getImportedCategoryTypes([file], columnMap, importedCategories, directionAnswers)).toEqual({
      [JOURNAL_NO_CATEGORY_SOURCE]: 'Expense',
      [IMPORT_NO_CATEGORY_MONEY_IN_SOURCE]: 'Income',
    })
    expect(build.rowProblems).toEqual([])
    expect(countRowsBySource(build)).toEqual({ [JOURNAL_NO_CATEGORY_SOURCE]: 1, [IMPORT_NO_CATEGORY_MONEY_IN_SOURCE]: 1 })
    expect(build.payload?.categories).toContainEqual({ source: IMPORT_NO_CATEGORY_MONEY_IN_SOURCE, category_id: OTHER_INCOME.id })
  })

  it('keeps one naming a transfer account under (transfer, no category)', () => {
    const file = createFile(['', ''], ['', 'Savings'])
    file.rows[1].Amount = '250.00'

    const { importedCategories } = importFile(file, WITH_TRANSFER_ACCOUNT)

    expect(importedCategories).toEqual([JOURNAL_NO_CATEGORY_SOURCE, IMPORT_NO_CATEGORY_TRANSFER_SOURCE])
  })

  // A zero, an unreadable or blank amount, or no amount column mapped yet says nothing about direction
  it('keeps rows whose amount states no direction under (no category)', () => {
    const file = createFile(['', '', ''])
    file.rows.forEach((row, index) => { row.Amount = ['0.00', 'abc', ''][index] })

    expect(getImportedCategories([file], WITH_CATEGORY, {})).toEqual([JOURNAL_NO_CATEGORY_SOURCE])
    expect(getImportedCategories([file], { ...WITH_CATEGORY, amount: '' }, {})).toEqual([JOURNAL_NO_CATEGORY_SOURCE])
  })
})

describe('a CSV file mapped without a Category column', () => {
  it('lets the column mapping finish without one', () => {
    const file = createFile(['Groceries', 'Dining'])

    expect(getMissingRequiredColumnLabels(WITHOUT_CATEGORY)).toEqual([])
    expect(isColumnMappingComplete(WITHOUT_CATEGORY, {}, [file])).toBe(true)
  })

  it('files every row under (no category)', () => {
    const file = createFile(['Groceries', 'Dining', ''])

    const { importedCategories, build } = importFile(file, WITHOUT_CATEGORY)

    expect(importedCategories).toEqual([JOURNAL_NO_CATEGORY_SOURCE])
    expect(build.errors).toEqual([])
    expect(countRowsBySource(build)).toEqual({ [JOURNAL_NO_CATEGORY_SOURCE]: 3 })
  })
})

describe('a CSV file where every row has a category', () => {
  it('lists no (no category) entry', () => {
    const file = createFile(['Groceries', 'Dining'])

    expect(getImportedCategories([file], WITH_CATEGORY, {})).toEqual(['Dining', 'Groceries'])
  })
})

describe('CSV rows with no category that name a transfer account', () => {
  // A transfer account cell holding only spaces names no account, so its row stays under (no category)
  it('lists them as (transfer, no category), matched to Transfer, and imports them as transfers', () => {
    const file = createFile(['Groceries', '', '', ''], ['', 'Savings', '', ' '])

    const { importedCategories, categoryMappings, build } = importFile(file, WITH_TRANSFER_ACCOUNT)

    expect(importedCategories).toEqual(['Groceries', JOURNAL_NO_CATEGORY_SOURCE, IMPORT_NO_CATEGORY_TRANSFER_SOURCE])
    expect(categoryMappings[IMPORT_NO_CATEGORY_TRANSFER_SOURCE]).toBe(TRANSFER.id)
    expect(getImportedCategoryTypes([file], WITH_TRANSFER_ACCOUNT, importedCategories, {})).toEqual({
      Groceries: 'Expense',
      [JOURNAL_NO_CATEGORY_SOURCE]: 'Expense',
      [IMPORT_NO_CATEGORY_TRANSFER_SOURCE]: 'Expense',
    })
    expect(build.errors).toEqual([])
    expect(build.rowProblems).toEqual([])
    expect(countRowsBySource(build)).toEqual({ Groceries: 1, [JOURNAL_NO_CATEGORY_SOURCE]: 2, [IMPORT_NO_CATEGORY_TRANSFER_SOURCE]: 1 })
    expect(build.payload?.rows.find((row) => row.category_source === IMPORT_NO_CATEGORY_TRANSFER_SOURCE)?.counterparty_account_source)
      .toBe('Savings')
  })

  it('files them under (transfer, no category) when no column is mapped as the category', () => {
    const file = createFile(['Groceries', ''], ['', 'Savings'])

    const { importedCategories, build } = importFile(file, { ...WITHOUT_CATEGORY, counterparty_account_id: 'Transfer Account' })

    expect(importedCategories).toEqual([JOURNAL_NO_CATEGORY_SOURCE, IMPORT_NO_CATEGORY_TRANSFER_SOURCE])
    expect(build.rowProblems).toEqual([])
    expect(countRowsBySource(build)).toEqual({ [JOURNAL_NO_CATEGORY_SOURCE]: 1, [IMPORT_NO_CATEGORY_TRANSFER_SOURCE]: 1 })
  })
})
