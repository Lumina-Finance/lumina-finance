/**
 * Tests that several files with one layout make one import: they share one account answer when no
 * account column is mapped, and a row skipped in one of them names its file beside its own row number
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import { CREATE_ACCOUNT_VALUE, EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import type { ImportFileDraft } from '@/pages/imports/types'
import {
  buildImportAccountMappingSources,
  buildImportPreviewRows,
  buildTransactionImportPayload,
  getStatedCurrencyByAccountSource,
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
const COLUMN_MAP = { ...EMPTY_COLUMN_MAP, dt: 'Date', category_id: 'Category', amount: 'Amount', currency: 'Currency' }

/**
 * Builds a monthly export holding the given dates, each a groceries purchase
 */
function monthlyFile(name: string, dates: string[]): ImportFileDraft {
  return {
    id: `id-${name}`,
    name,
    size: 100,
    headers: ['Date', 'Category', 'Amount', 'Currency'],
    hasHeaderRow: true,
    rows: dates.map((date) => ({ Date: date, Category: 'Groceries', Amount: '-12.34', Currency: 'CAD' })),
    error: null,
    delimiter: ',',
  }
}

const MARCH = monthlyFile('2024-03.csv', ['2024-03-01', '2024-03-02', '2024-03-03', '2024-03-04', '2024-03-05', '2024-03-06', 'someday'])
const APRIL = monthlyFile('2024-04.csv', ['2024-04-01', '2024-04-02'])

// Every answer the build needs other than the files and what depends on them
const BASE_BUILD = {
  accountById: new Map([[ACCOUNT.id, ACCOUNT]]),
  accountCreateCurrencies: {},
  accountCreateInstitutions: {},
  accountCreateTypes: {},
  categoryById: new Map([[CATEGORY.id, CATEGORY]]),
  categoryCreateKinds: {},
  categoryMappings: { Groceries: CATEGORY.id },
  categoryTypesBySource: {},
  columnMap: COLUMN_MAP,
  columnValidationErrors: {},
  currencies: CURRENCIES,
  dateFormat: 'yearFirst' as const,
  dateRange: WHOLE_FILE_DATE_RANGE,
  directionAnswers: {},
  importedCategories: ['Groceries'],
}

/**
 * Builds the payload for the files with the single account answer a file with no account column asks for
 */
function build(files: ImportFileDraft[]) {
  const accountSources = buildImportAccountMappingSources(files, '', '')
  return buildTransactionImportPayload({
    ...BASE_BUILD,
    accountMappings: Object.fromEntries(accountSources.map((source) => [source.id, ACCOUNT.id])),
    accountSources,
    files,
  })
}

describe('the account every file of one import is written to', () => {
  it('is asked once for all the files when no account column is mapped', () => {
    const sources = buildImportAccountMappingSources([MARCH, APRIL], '', '')

    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({ id: MARCH.id, label: '2024-03', matchText: '2024-03.csv' })
  })

  it('is the one source every row of every file is sent under', () => {
    const { payload } = build([MARCH, APRIL])

    expect(payload?.accounts).toHaveLength(1)
    expect(new Set(payload?.rows.map((row) => row.account_source))).toEqual(new Set([MARCH.id]))
    expect(payload?.rows).toHaveLength(8)
  })

  it('takes the currency the files state across all of them', () => {
    expect(getStatedCurrencyByAccountSource([MARCH, APRIL], '', 'Currency', new Set(['CAD'])))
      .toEqual({ [MARCH.id]: 'CAD' })
  })
})

describe('a chosen date range across several files', () => {
  it('sends only the rows inside the dates, from whichever file they are in', () => {
    const files = [monthlyFile('2024-03.csv', ['2024-03-30', '2024-03-31']), monthlyFile('2024-04.csv', ['2024-04-01', '2024-04-02'])]
    const accountSources = buildImportAccountMappingSources(files, '', '')

    const { payload } = buildTransactionImportPayload({
      ...BASE_BUILD,
      accountMappings: { [accountSources[0].id]: ACCOUNT.id },
      accountSources,
      dateRange: { from: '2024-03-31', to: '2024-04-01' },
      files,
    })

    expect(payload?.rows.map((row) => row.dt.slice(0, 10))).toEqual(['2024-03-31', '2024-04-01'])
  })
})

describe('a row skipped in one of several files', () => {
  it('keeps its position in its own file and names the file', () => {
    const { rowProblems } = build([APRIL, MARCH])

    expect(rowProblems).toHaveLength(1)
    expect(rowProblems[0]).toMatchObject({ rowNumber: 7, fileName: '2024-03.csv' })
  })

  it('leaves the preview showing every good row of both files under the one account', () => {
    const files = [APRIL, MARCH]
    const accountSources = buildImportAccountMappingSources(files, '', '')
    const { rowProblems } = build(files)

    const preview = buildImportPreviewRows({
      files,
      columnMap: COLUMN_MAP,
      dateFormat: 'yearFirst',
      dateRange: WHOLE_FILE_DATE_RANGE,
      directionAnswers: {},
      missingRequiredColumnLabels: [],
      currencies: CURRENCIES,
      accountById: new Map([[ACCOUNT.id, ACCOUNT]]),
      accountCreateCurrencies: {},
      accountCreateInstitutions: {},
      categoryById: new Map([[CATEGORY.id, CATEGORY]]),
      categoryCreateKinds: {},
      categoryTypesBySource: {},
      institutionById: new Map(),
      resolvedAccountMappings: { [accountSources[0].id]: ACCOUNT.id },
      resolvedCategoryMappings: { Groceries: CATEGORY.id },
      rowProblems,
    })

    expect(preview.some((row) => row.id.includes(APRIL.id))).toBe(true)
    expect(preview.some((row) => row.id.includes(MARCH.id))).toBe(true)
    expect(new Set(preview.map((row) => row.accountName))).toEqual(new Set(['Chequing']))
  })

  // With no account column the one account every file is written to is proposed under the first
  // file's name, which stands for all of them
  it('proposes the first file\'s name for the new account every file is written to', () => {
    const files = [APRIL, MARCH]
    const accountSources = buildImportAccountMappingSources(files, '', '')

    const preview = buildImportPreviewRows({
      files,
      columnMap: COLUMN_MAP,
      dateFormat: 'yearFirst',
      dateRange: WHOLE_FILE_DATE_RANGE,
      directionAnswers: {},
      missingRequiredColumnLabels: [],
      currencies: CURRENCIES,
      accountById: new Map(),
      accountCreateCurrencies: { [accountSources[0].id]: 'CAD' },
      accountCreateInstitutions: {},
      categoryById: new Map([[CATEGORY.id, CATEGORY]]),
      categoryCreateKinds: {},
      categoryTypesBySource: {},
      institutionById: new Map(),
      resolvedAccountMappings: { [accountSources[0].id]: CREATE_ACCOUNT_VALUE },
      resolvedCategoryMappings: { Groceries: CATEGORY.id },
      rowProblems: build(files).rowProblems,
    })

    expect(accountSources).toMatchObject([{ label: '2024-04' }])
    expect(new Set(preview.map((row) => row.accountName))).toEqual(new Set(['2024-04']))
  })
})
