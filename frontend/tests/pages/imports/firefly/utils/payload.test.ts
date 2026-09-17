/**
 * Tests Firefly III commit payload validation and completed summary formatting
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { FireflyTransactionImportResponse } from '@/api/firefly-imports'
import type { CsvRow, ImportFileDraft } from '@/pages/imports/types'
import { buildFireflyImportPayload, formatFireflyImportSummary } from '@/pages/imports/firefly/utils'

const CHEQUING = { id: 'chequing', name: 'Chequing', is_archived: false } as AccountsOverview
const ARCHIVED = { id: 'old-savings', name: 'Old Savings', is_archived: true } as AccountsOverview

const ROW: CsvRow = {
  journal_id: '1',
  type: 'Withdrawal',
  date: '2026-06-11 00:00:00',
  amount: '-12.34',
  currency_code: 'CAD',
  foreign_amount: '',
  foreign_currency_code: '',
  description: 'Weekly shop',
  source_name: 'Chequing',
  source_type: 'Asset account',
  destination_name: 'Market',
  destination_type: 'Expense account',
  category: 'Groceries',
  tags: '',
  notes: '',
}

const TRANSACTIONS_FILE = {
  id: 'firefly',
  name: 'transactions.csv',
  size: 128,
  headers: Object.keys(ROW),
  rows: [ROW],
  hasHeaderRow: true,
} as ImportFileDraft

/** Creates a complete Firefly result with empty counters and mappings unless overridden */
function createImportResult(
  overrides: Partial<FireflyTransactionImportResponse> = {},
): FireflyTransactionImportResponse {
  return {
    transactions_created: 0,
    accounts_created: 0,
    accounts_reused: 0,
    categories_created: 0,
    categories_reused: 0,
    merchants_created: 0,
    merchants_reused: 0,
    tags_created: 0,
    tags_reused: 0,
    affected_account_ids: [],
    account_source_ids: {},
    category_source_ids: {},
    created_account_ids: [],
    created_category_ids: [],
    created_merchant_ids: [],
    created_tag_ids: [],
    rows_imported: 0,
    rows_skipped: 0,
    skipped: [],
    ...overrides,
  }
}

/**
 * Builds the payload for one tracked account mapped to the given account id
 */
function buildWithMapping(accountId: string, accounts: AccountsOverview[], row: CsvRow = ROW) {
  return buildFireflyImportPayload({
    transactionsFile: TRANSACTIONS_FILE,
    rows: [row],
    trackedAccountNames: ['Chequing'],
    accountMappings: { Chequing: accountId },
    accountById: new Map(accounts.map((account) => [account.id, account])),
    accountCreateDetails: {},
    importedCategories: ['Groceries'],
    categoryMappings: { Groceries: 'groceries' },
    categoryCreateKinds: {},
  })
}

describe('a Firefly account archived after it was mapped', () => {
  it('refuses the commit and says which source', () => {
    const result = buildWithMapping(ARCHIVED.id, [CHEQUING, ARCHIVED])

    expect(result.payload).toBeNull()
    expect(result.errors).toContain('Map to an account that is not archived: Chequing')
  })

  it('accepts the same mapping while the account is not archived', () => {
    const result = buildWithMapping(CHEQUING.id, [CHEQUING, ARCHIVED])

    expect(result.errors).not.toContain('Map to an account that is not archived: Chequing')
    expect(result.payload?.accounts).toEqual([{ source: 'Chequing', account_id: CHEQUING.id }])
  })
})


describe('Firefly amount payloads', () => {
  it('trims primary and foreign decimal text without changing their digits', () => {
    const result = buildWithMapping(CHEQUING.id, [CHEQUING], {
      ...ROW,
      amount: ' \t-1234.5600\n',
      foreign_amount: '\ufeff-100.99\u00a0',
      foreign_currency_code: 'USD',
    })

    expect(result.errors).toEqual([])
    expect(result.payload?.rows[0]).toMatchObject({
      amount: '-1234.5600',
      foreign_amount: '-100.99',
    })
  })
})

describe('a Firefly export with no uploadable rows', () => {
  it('refuses the commit with the export-specific message', () => {
    const result = buildFireflyImportPayload({
      transactionsFile: TRANSACTIONS_FILE,
      rows: [],
      trackedAccountNames: [],
      accountMappings: {},
      accountById: new Map(),
      accountCreateDetails: {},
      importedCategories: [],
      categoryMappings: {},
      categoryCreateKinds: {},
    })

    expect(result.errors).toEqual(['This export has no transaction rows to import.'])
    expect(result.payload).toBeNull()
  })
})

describe('Firefly account mapping completeness', () => {
  const rows = [
    { ...ROW, journal_id: '1', source_name: 'Everyday Chequing' },
    { ...ROW, journal_id: '2', source_name: 'Everyday Chequing Card One', amount: '-56.78' },
  ]
  const trackedAccountNames = ['Everyday Chequing', 'Everyday Chequing Card One']

  it('lists every unresolved tracked account and refuses the payload', () => {
    const result = buildFireflyImportPayload({
      transactionsFile: TRANSACTIONS_FILE,
      rows,
      trackedAccountNames,
      accountMappings: {},
      accountById: new Map([[CHEQUING.id, CHEQUING]]),
      accountCreateDetails: {},
      importedCategories: ['Groceries'],
      categoryMappings: { Groceries: 'groceries' },
      categoryCreateKinds: {},
    })

    expect(result.errors).toEqual([
      'Map account: Everyday Chequing',
      'Map account: Everyday Chequing Card One',
    ])
    expect(result.payload).toBeNull()
  })

  it('accepts deliberate mappings from both tracked names to the same account', () => {
    const result = buildFireflyImportPayload({
      transactionsFile: TRANSACTIONS_FILE,
      rows,
      trackedAccountNames,
      accountMappings: {
        'Everyday Chequing': CHEQUING.id,
        'Everyday Chequing Card One': CHEQUING.id,
      },
      accountById: new Map([[CHEQUING.id, CHEQUING]]),
      accountCreateDetails: {},
      importedCategories: ['Groceries'],
      categoryMappings: { Groceries: 'groceries' },
      categoryCreateKinds: {},
    })

    expect(result.errors).toEqual([])
    expect(result.payload?.accounts).toEqual([
      { source: 'Everyday Chequing', account_id: CHEQUING.id },
      { source: 'Everyday Chequing Card One', account_id: CHEQUING.id },
    ])
    expect(result.payload?.rows).toHaveLength(2)
  })
})

describe('the completed Firefly import summary', () => {
  it('counts rows dropped by the browser beside rows skipped by the server', () => {
    const result = createImportResult({
      rows_imported: 1,
      transactions_created: 1,
      rows_skipped: 1,
      skipped: [{ journal_id: 'server-skip', reason: 'Skipped by the server' }],
    })
    const summary = formatFireflyImportSummary(
      result,
      { browserDroppedCount: 1, budgetsCreated: 0 },
    )

    expect(summary).toBe('1 row imported · 1 transaction created · 2 skipped')
  })

  it('preserves the server-only total when the browser drops no rows', () => {
    const result = createImportResult({
      rows_imported: 1,
      transactions_created: 1,
      rows_skipped: 1,
      skipped: [{ journal_id: 'server-skip', reason: 'Skipped by the server' }],
    })
    const summary = formatFireflyImportSummary(
      result,
      { browserDroppedCount: 0, budgetsCreated: 0 },
    )

    expect(summary).toBe('1 row imported · 1 transaction created · 1 skipped')
  })

  it('preserves plural row, transaction and budget segments in their current order', () => {
    const result = createImportResult({
      rows_imported: 2,
      transactions_created: 2,
      rows_skipped: 0,
    })
    const summary = formatFireflyImportSummary(
      result,
      { browserDroppedCount: 1, budgetsCreated: 2 },
    )

    expect(summary).toBe('2 rows imported · 2 transactions created · 1 skipped · 2 budgets imported')
  })
})
