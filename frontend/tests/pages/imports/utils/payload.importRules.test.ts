/**
 * Tests the rows the CSV import asks the import rules about, the rows the save would send
 *
 * These tests catch the rules being asked about rows other than the ones saved, a row the import
 * leaves out still counted for a rule, and a rule's tags that push a row past the most a
 * transaction carries going unnoticed
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { ImportRuleRowMatch } from '@/api/import-rules'
import { CREATE_ACCOUNT_VALUE, EMPTY_COLUMN_MAP, MAX_IMPORT_TAGS_PER_ROW } from '@/pages/imports/constants'
import type { CsvRow, ImportFileDraft, ImportRuleMatchLookup } from '@/pages/imports/types'
import { buildTransactionImportPayload, getImportRowId, WHOLE_FILE_DATE_RANGE } from '@/pages/imports/utils'

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
const HEADERS = ['Date', 'Category', 'Amount', 'Merchant', 'Notes', 'Tags']
const NONE: ImportRuleRowMatch = { merchant: null, category: null, tags: [], tag_count: 0 }

function file(rows: CsvRow[]): ImportFileDraft {
  return { id: 'file-1', name: 'Chequing.csv', size: 512, headers: HEADERS, hasHeaderRow: true, rows, error: null }
}

function csvRow(extra: Partial<CsvRow> = {}): CsvRow {
  return {
    Date: '2026-04-10',
    Category: 'Groceries',
    Amount: '-12.34',
    Merchant: 'Cafe',
    Notes: 'n',
    Tags: 'a,b',
    ...extra,
  }
}

function build(
  rows: CsvRow[],
  options: {
    account?: string
    categoryType?: string
    ruleMatches?: ImportRuleMatchLookup | null
  } = {},
) {
  const account = options.account ?? ACCOUNT.id
  return buildTransactionImportPayload({
    accountById: new Map([[ACCOUNT.id, ACCOUNT]]),
    accountCreateCurrencies: { 'file-1': 'CAD' },
    accountCreateInstitutions: {},
    accountCreateTypes: { 'file-1': 'checking' },
    accountMappings: { 'file-1': account },
    accountSources: [{ id: 'file-1', label: 'Chequing.csv', matchText: 'Chequing.csv', isCounterpartyOnly: false }],
    categoryById: new Map([
      [CATEGORY.id, options.categoryType ? { ...CATEGORY, kind: options.categoryType as Category['kind'] } : CATEGORY],
    ]),
    categoryCreateKinds: {},
    categoryMappings: { Groceries: CATEGORY.id },
    categoryTypesBySource: {},
    columnMap: {
      ...EMPTY_COLUMN_MAP,
      dt: 'Date',
      category_id: 'Category',
      amount: 'Amount',
      merchant_id: 'Merchant',
      notes: 'Notes',
      tag_ids: 'Tags',
    },
    columnValidationErrors: {},
    currencies: CURRENCIES,
    dateFormat: 'yearFirst',
    dateRange: WHOLE_FILE_DATE_RANGE,
    directionAnswers: {},
    files: [file(rows)],
    importedCategories: ['Groceries'],
    ruleMatches: options.ruleMatches ?? null,
  })
}

describe('the rows asked of the import rules', () => {
  it('are the rows the save sends, with the cells as they are sent', () => {
    const result = build([csvRow()])

    expect(result.ruleRows).toHaveLength(1)
    expect(result.ruleRows[0]).toEqual({
      id: getImportRowId('file-1', 0),
      request: {
        description: 'Cafe',
        note: 'n',
        amount: result.payload?.rows[0].amount,
        currency: 'CAD',
        account_id: ACCOUNT.id,
        is_transfer: false,
        tag_names: result.payload?.rows[0].tag_names,
      },
    })
    expect(result.ruleRows[0].request.tag_names).toEqual(['a', 'b'])
  })

  it('name no account for one the import creates', () => {
    const result = build([csvRow()], { account: CREATE_ACCOUNT_VALUE })
    expect(result.ruleRows[0].request.account_id).toBeNull()
  })

  it('flag a row filed as a transfer', () => {
    const result = build([csvRow()], { categoryType: 'transfer' })
    expect(result.ruleRows[0].request.is_transfer).toBe(true)
  })

  it('leave out a row the import refuses', () => {
    const result = build([csvRow(), csvRow({ Date: 'not a date' })])
    expect(result.ruleRows.map((row) => row.id)).toEqual([getImportRowId('file-1', 0)])
  })
})

describe('a row the rules leave with too many tags', () => {
  it('is refused with its row number and left out of the payload', () => {
    const rowId = getImportRowId('file-1', 1)
    const over: ImportRuleRowMatch = { ...NONE, tag_count: MAX_IMPORT_TAGS_PER_ROW + 1 }
    const result = build([csvRow(), csvRow()], { ruleMatches: new Map([[rowId, over]]) })

    expect(result.rowProblems.map((problem) => problem.id)).toEqual([rowId])
    expect(result.rowProblems[0].rowNumber).toBe(2)
    expect(result.payload?.rows).toHaveLength(1)
    expect(result.ruleRows.map((row) => row.id)).toEqual([getImportRowId('file-1', 0)])
  })

  it('is kept at exactly the limit', () => {
    const rowId = getImportRowId('file-1', 0)
    const atLimit: ImportRuleRowMatch = { ...NONE, tag_count: MAX_IMPORT_TAGS_PER_ROW }
    const result = build([csvRow()], { ruleMatches: new Map([[rowId, atLimit]]) })
    expect(result.rowProblems).toEqual([])
    expect(result.payload?.rows).toHaveLength(1)
  })
})
