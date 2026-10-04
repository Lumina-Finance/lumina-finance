/**
 * Tests CSV rows with no category, which are listed together as (no category), matched to
 * Miscellaneous and imported there unless the user matches them elsewhere, as the provider imports do
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import { JOURNAL_NO_CATEGORY_SOURCE } from '@/api/provider-imports'
import { EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import type { ColumnMap, CsvRow, ImportFileDraft } from '@/pages/imports/types'
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

const CATEGORIES = [MISCELLANEOUS, GROCERIES]

const WITH_CATEGORY: ColumnMap = { ...EMPTY_COLUMN_MAP, dt: 'Date', category_id: 'Category', amount: 'Amount' }
const WITHOUT_CATEGORY: ColumnMap = { ...EMPTY_COLUMN_MAP, dt: 'Date', amount: 'Amount' }

/**
 * Creates a one-file import of rows filed under the given categories, a blank one standing for a
 * row with no category
 */
function createFile(categories: string[]): ImportFileDraft {
  const rows: CsvRow[] = categories.map((category) => ({ Date: '2026-04-11', Category: category, Amount: '-40.00' }))
  return { id: 'file-1', name: 'Chequing.csv', size: 512, headers: ['Date', 'Category', 'Amount'], hasHeaderRow: true, rows, error: null }
}

/**
 * Lists the categories, matches them the way the category step does, and builds the import with the
 * user's own answers laid over the match
 */
function importFile(file: ImportFileDraft, columnMap: ColumnMap, answers: Record<string, string> = {}) {
  const importedCategories = getImportedCategories([file], columnMap.category_id)
  const categoryMappings = inferCategoryMappings(importedCategories, answers, CATEGORIES)
  const build = buildTransactionImportPayload({
    accountById: new Map(),
    accountCreateCurrencies: {},
    accountCreateInstitutions: {},
    accountCreateTypes: {},
    accountMappings: { 'file-1': 'account-1' },
    accountSources: [{ id: 'file-1', label: 'Chequing.csv', matchText: 'Chequing.csv', isCounterpartyOnly: false }],
    categoryById: new Map(CATEGORIES.map((category) => [category.id, category])),
    categoryCreateKinds: {},
    categoryMappings,
    categoryTypesBySource: {},
    columnMap,
    columnValidationErrors: {},
    currencies: CURRENCIES,
    dateFormat: 'yearFirst',
    directionAnswers: {},
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

    expect(getImportedCategories([file], 'Category')).toEqual(['Dining', 'Groceries'])
  })
})
