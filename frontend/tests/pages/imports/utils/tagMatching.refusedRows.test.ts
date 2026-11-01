/**
 * Tests that the tag step asks about the spelling the commit files a tag under, which comes from
 * the rows that will import and never from a row the import refuses
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import { EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import type { CsvRow, ImportFileDraft } from '@/pages/imports/types'
import {
  buildTransactionImportPayload,
  excludeRefusedRows,
  getImportedTags,
  getPreviewTagNames,
  includeEveryImportRow,
  WHOLE_FILE_DATE_RANGE,
} from '@/pages/imports/utils'

const CURRENCIES: Currency[] = [{ id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 }]

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

const ACCOUNT = { id: 'account-1', name: 'Chequing', currency: 'CAD', can_write: true } as AccountsOverview

/**
 * Builds the commit payload for rows carrying the given tag and amount cells
 */
function build(cells: Array<[tag: string, amount: string]>) {
  const rows: CsvRow[] = cells.map(([Tags, Amount]) => ({ Date: '2026-04-10', Category: 'Groceries', Amount, Tags }))
  const file: ImportFileDraft = {
    id: 'file-1',
    name: 'Chequing.csv',
    size: 512,
    headers: ['Date', 'Category', 'Amount', 'Tags'],
    hasHeaderRow: true,
    rows,
    error: null,
  }
  const result = buildTransactionImportPayload({
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
    columnMap: { ...EMPTY_COLUMN_MAP, dt: 'Date', category_id: 'Category', amount: 'Amount', tag_ids: 'Tags' },
    columnValidationErrors: {},
    currencies: CURRENCIES,
    dateFormat: 'yearFirst',
    dateRange: WHOLE_FILE_DATE_RANGE,
    directionAnswers: {},
    files: [file],
    importedCategories: ['Groceries'],
  })
  return { file, result }
}

describe('the spelling of a tag when a row carrying it is refused', () => {
  it('asks about the spelling of the rows that import, not of a row refused for its amount', () => {
    const { file, result } = build([
      ['TRAVEL', 'not an amount'],
      ['travel', '-12.34'],
    ])

    expect(result.rowProblems).toHaveLength(1)
    expect(result.payload?.rows.map((row) => row.tag_names)).toEqual([['travel']])
    const refused = excludeRefusedRows(
      includeEveryImportRow,
      result.rowProblems.map((problem) => problem.cells),
    )
    const importedTags = getImportedTags([file], 'Tags', refused)
    expect(importedTags).toEqual(['travel'])

    // The preview of the row that imports shows the same spelling
    const preview = getPreviewTagNames(['travel'], {
      importedTags,
      matchedTagByKey: new Map(),
      tagMappings: {},
      tagCreateNames: {},
      tagLabelById: new Map(),
    })
    expect(preview).toEqual(['travel'])
  })
})
