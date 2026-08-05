/**
 * Tests the limits the importer checks before anything is uploaded: what one row may carry, named
 * against its row number, and how many distinct values a whole import may declare
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import {
  EMPTY_COLUMN_MAP,
  getRowNotesTooLongReason,
  getRowTooManyTagsReason,
  getTooManyMappingsError,
  MAX_IMPORT_MAPPINGS,
  MAX_IMPORT_NOTES_LENGTH,
  MAX_IMPORT_TAGS_PER_ROW,
} from '@/pages/imports/constants'
import type { CsvRow, ImportFileDraft } from '@/pages/imports/types'
import { buildTransactionImportPayload } from '@/pages/imports/utils'

const CURRENCIES: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
]

const CATEGORY: Category = {
  id: 'category-1',
  group_id: null,
  owner_id: null,
  name: 'Groceries',
  kind: 'expense',
  icon: null,
  is_system: false,
  created_at: '2026-01-01T00:00:00Z',
}

const ACCOUNT = { id: 'account-1', name: 'Chequing', currency: 'CAD' } as AccountsOverview
const HEADERS = ['Date', 'Category', 'Amount', 'Notes', 'Tags']

/**
 * Builds a commit payload for one row carrying the given notes and tag cell
 */
function build(notes: string, tags: string) {
  const rows: CsvRow[] = [{
    Date: '2026-04-10',
    Category: 'Groceries',
    Amount: '-12.34',
    Notes: notes,
    Tags: tags,
  }]
  const file: ImportFileDraft = {
    id: 'file-1',
    name: 'Chequing.csv',
    size: 512,
    headers: HEADERS,
    hasHeaderRow: true,
    rows,
    error: null,
  }

  return buildTransactionImportPayload({
    accountById: new Map([[ACCOUNT.id, ACCOUNT]]),
    accountCreateCurrencies: {},
    accountCreateInstitutions: {},
    accountCreateTypes: {},
    accountMappings: { 'file-1': ACCOUNT.id },
    accountSources: [{ id: 'file-1', label: 'Chequing.csv', matchText: 'Chequing.csv', isCounterpartyOnly: false }],
    categoryById: new Map([[CATEGORY.id, CATEGORY]]),
    categoryCreateKinds: {},
    categoryMappings: { Groceries: CATEGORY.id },
    categoryTypesBySource: {},
    columnMap: {
      ...EMPTY_COLUMN_MAP,
      dt: 'Date',
      category_id: 'Category',
      amount: 'Amount',
      notes: 'Notes',
      tag_ids: 'Tags',
    },
    columnValidationErrors: {},
    currencies: CURRENCIES,
    dateFormat: 'yearFirst',
    files: [file],
    importedCategories: ['Groceries'],
    noPayeeColumnConfirmed: true,
  })
}

/**
 * Builds a tag cell holding the given number of tags
 */
function tagCell(count: number) {
  return Array.from({ length: count }, (_, index) => `Tag ${index + 1}`).join(',')
}

describe('refusing a row whose notes are too long', () => {
  it('lists the row with its length and the limit', () => {
    const notes = 'n'.repeat(MAX_IMPORT_NOTES_LENGTH + 1)
    const result = build(notes, '')

    expect(result.payload).toBeNull()
    expect(result.rowProblems).toHaveLength(1)
    expect(result.rowProblems[0].rowNumber).toBe(1)
    expect(result.rowProblems[0].reason).toBe(getRowNotesTooLongReason(MAX_IMPORT_NOTES_LENGTH + 1))
  })

  it('accepts notes sitting exactly on the limit', () => {
    expect(build('n'.repeat(MAX_IMPORT_NOTES_LENGTH), '').rowProblems).toEqual([])
  })
})

describe('refusing a row carrying too many tags', () => {
  it('lists the row with its count and the limit', () => {
    const result = build('', tagCell(MAX_IMPORT_TAGS_PER_ROW + 1))

    expect(result.payload).toBeNull()
    expect(result.rowProblems).toHaveLength(1)
    expect(result.rowProblems[0].reason).toBe(getRowTooManyTagsReason(MAX_IMPORT_TAGS_PER_ROW + 1))
  })

  it('accepts a row sitting exactly on the limit', () => {
    expect(build('', tagCell(MAX_IMPORT_TAGS_PER_ROW)).rowProblems).toEqual([])
  })

  // The import keeps one of each name, so a cell repeating three tags eleven times stores three
  // tags. Counting the repeats would refuse a row the import would have written
  it('counts the tags the row will carry rather than the entries in the cell', () => {
    const repeated = Array.from({ length: 11 }, () => 'groceries;food;weekly').join(';')
    const result = build('', repeated)

    expect(result.rowProblems).toEqual([])
    expect(result.payload?.rows[0].tag_names).toEqual(['groceries', 'food', 'weekly'])
  })
})

describe('refusing an import declaring more values than it may carry', () => {
  // The count comes off the file itself, so the refusal does not wait for the mapping answers. A
  // user who has to map 1,001 categories by hand before being told the import cannot run has done
  // all of that work for nothing
  it('says so while every category is still unmapped', () => {
    const result = buildWithManyCategories(MAX_IMPORT_MAPPINGS + 1, { mapped: false })

    expect(result.payload).toBeNull()
    expect(result.errors).toContain(getTooManyMappingsError('category', MAX_IMPORT_MAPPINGS + 1))
  })

  it('says so once they are mapped as well', () => {
    const result = buildWithManyCategories(MAX_IMPORT_MAPPINGS + 1, { mapped: true })

    expect(result.payload).toBeNull()
    expect(result.errors).toContain(getTooManyMappingsError('category', MAX_IMPORT_MAPPINGS + 1))
  })

  it('accepts an import sitting exactly on the limit', () => {
    const result = buildWithManyCategories(MAX_IMPORT_MAPPINGS, { mapped: true })

    expect(result.errors).not.toContain(getTooManyMappingsError('category', MAX_IMPORT_MAPPINGS))
  })
})

/**
 * Builds a payload for a file whose category column holds the given number of distinct values
 *
 * Leaving them unmapped is the state a user is in before answering the matching step, which is
 * where the count has to be known
 */
function buildWithManyCategories(count: number, { mapped }: { mapped: boolean }) {
  const sources = Array.from({ length: count }, (_, index) => `Category ${index}`)
  const rows: CsvRow[] = sources.map((source) => ({
    Date: '2026-04-10',
    Category: source,
    Amount: '-12.34',
    Notes: '',
    Tags: '',
  }))
  const file: ImportFileDraft = {
    id: 'file-1',
    name: 'Chequing.csv',
    size: 512,
    headers: HEADERS,
    hasHeaderRow: true,
    rows,
    error: null,
  }

  return buildTransactionImportPayload({
    accountById: new Map([[ACCOUNT.id, ACCOUNT]]),
    accountCreateCurrencies: {},
    accountCreateInstitutions: {},
    accountCreateTypes: {},
    accountMappings: { 'file-1': ACCOUNT.id },
    accountSources: [{ id: 'file-1', label: 'Chequing.csv', matchText: 'Chequing.csv', isCounterpartyOnly: false }],
    categoryById: new Map([[CATEGORY.id, CATEGORY]]),
    categoryCreateKinds: {},
    categoryMappings: mapped ? Object.fromEntries(sources.map((source) => [source, CATEGORY.id])) : {},
    categoryTypesBySource: {},
    columnMap: {
      ...EMPTY_COLUMN_MAP,
      dt: 'Date',
      category_id: 'Category',
      amount: 'Amount',
    },
    columnValidationErrors: {},
    currencies: CURRENCIES,
    dateFormat: 'yearFirst',
    files: [file],
    importedCategories: sources,
    noPayeeColumnConfirmed: true,
  })
}
