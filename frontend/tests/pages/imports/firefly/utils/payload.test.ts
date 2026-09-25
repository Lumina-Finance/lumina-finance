/**
 * Tests Firefly III commit payload validation and completed summary formatting
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Currency } from '@/api/currency'
import type { FireflyTransactionImportPayload, FireflyTransactionImportResponse } from '@/api/firefly-imports'
import type { Category } from '@/api/categories'
import { CREATE_ACCOUNT_VALUE, CREATE_CATEGORY_VALUE, MAX_IMPORT_NOTES_LENGTH } from '@/pages/imports/constants'
import type { CsvRow, ImportFileDraft } from '@/pages/imports/types'
import {
  buildFireflyAccountPrefills,
  buildFireflyCategoryKinds,
  buildFireflyImportPayload,
  buildFireflyPreviewRows,
  forecastFireflyImport,
  formatFireflyImportSummary,
  getFireflyAccountSources,
  getFireflyImportedCategories,
  inferFireflyCategoryMappings,
  readFireflyCsvFile,
  resolveFireflyRowLegs,
} from '@/pages/imports/firefly/utils'
import { createNameKeyedAccountSources, stageFireflyImportAsNew } from './fixtures'

const { postBatchMock } = vi.hoisted(() => ({ postBatchMock: vi.fn() }))

vi.mock('@/api/firefly-imports/requests', () => ({
  postFireflyTransactionImportBatch: postBatchMock,
}))

import { importFireflyTransactionsInBatches } from '@/api/firefly-imports'

const CHEQUING = { id: 'chequing', name: 'Chequing', can_write: true, is_archived: false } as AccountsOverview
const ARCHIVED = { id: 'old-savings', name: 'Old Savings', can_write: true, is_archived: true } as AccountsOverview
const SHARED = { id: 'family-savings', name: 'Family Savings', can_write: false, is_archived: false } as AccountsOverview

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
    accountSources: createNameKeyedAccountSources(['Chequing']),
    accountMappings: { Chequing: accountId },
    accountById: new Map(accounts.map((account) => [account.id, account])),
    accountCreateDetails: {},
    importedCategories: ['Groceries'],
    categoryMappings: { Groceries: 'groceries' },
    categoryCreateKinds: {},
    categoryById: new Map(),
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

// Every Firefly source takes rows, and the API writes rows only where the user can write
describe('a Firefly account the user can only read', () => {
  it('refuses the commit and says which source', () => {
    const result = buildWithMapping(SHARED.id, [CHEQUING, SHARED])

    expect(result.payload).toBeNull()
    expect(result.errors).toContain('Map to an account you can write to: Chequing')
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
      accountSources: createNameKeyedAccountSources([]),
      accountMappings: {},
      accountById: new Map(),
      accountCreateDetails: {},
      importedCategories: [],
      categoryMappings: {},
      categoryCreateKinds: {},
      categoryById: new Map(),
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
  const accountSources = createNameKeyedAccountSources(['Everyday Chequing', 'Everyday Chequing Card One'])

  it('lists every unresolved tracked account and refuses the payload', () => {
    const result = buildFireflyImportPayload({
      transactionsFile: TRANSACTIONS_FILE,
      rows,
      accountSources,
      accountMappings: {},
      accountById: new Map([[CHEQUING.id, CHEQUING]]),
      accountCreateDetails: {},
      importedCategories: ['Groceries'],
      categoryMappings: { Groceries: 'groceries' },
      categoryCreateKinds: {},
      categoryById: new Map(),
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
      accountSources,
      accountMappings: {
        'Everyday Chequing': CHEQUING.id,
        'Everyday Chequing Card One': CHEQUING.id,
      },
      accountById: new Map([[CHEQUING.id, CHEQUING]]),
      accountCreateDetails: {},
      importedCategories: ['Groceries'],
      categoryMappings: { Groceries: 'groceries' },
      categoryCreateKinds: {},
      categoryById: new Map(),
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

describe('a Firefly account name longer than a new account takes', () => {
  const createRows = (name: string) => [{ ...ROW, source_name: name }]
  const buildForName = (name: string, choice: string) => {
    const rows = createRows(name)
    const accountSources = getFireflyAccountSources(rows)
    return buildFireflyImportPayload({
      transactionsFile: TRANSACTIONS_FILE,
      rows,
      accountSources,
      accountMappings: { 'account-1': choice },
      accountById: new Map([[CHEQUING.id, CHEQUING]]),
      accountCreateDetails: { 'account-1': { accountType: 'checking', currency: 'CAD', institutionId: '' } },
      importedCategories: ['Groceries'],
      categoryMappings: { Groceries: 'groceries' },
      categoryCreateKinds: {},
      categoryById: new Map(),
    })
  }

  it('creates an account under a name of 256 characters', () => {
    const name = 'A'.repeat(256)

    expect(buildForName(name, CREATE_ACCOUNT_VALUE).payload?.accounts[0]).toMatchObject({ create: { name } })
  })

  it('asks for an existing account in place of creating one named with 257 characters', () => {
    const name = 'A'.repeat(257)

    const result = buildForName(name, CREATE_ACCOUNT_VALUE)

    expect(result.payload).toBeNull()
    expect(result.errors).toEqual([
      `Map to an existing account, since a new account name holds at most 256 characters: ${name}`,
    ])
  })

  it('imports into the existing account the long name is mapped to', () => {
    const result = buildForName('A'.repeat(257), CHEQUING.id)

    expect(result.errors).toEqual([])
    expect(result.payload?.accounts).toEqual([{ source: 'account-1', account_id: CHEQUING.id }])
    expect(result.payload?.rows[0].source_account).toBe('account-1')
  })
})

describe('a Firefly asset account and loan sharing a name', () => {
  const CURRENCIES: Currency[] = [{ id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 }]
  // Firefly III writes an asset's opening balance into the account and a loan's out of it
  const openingBalance: CsvRow = {
    ...ROW,
    journal_id: '1',
    type: 'Opening balance',
    amount: '1000.00',
    description: 'Initial balance for "Car"',
    source_name: 'Initial balance for "Car"',
    source_type: 'Initial balance account',
    destination_name: 'Car',
    destination_type: 'Asset account',
    category: '',
  }
  const loanOpeningBalance: CsvRow = {
    ...openingBalance,
    journal_id: '2',
    amount: '-5000.00',
    source_name: 'Car',
    source_type: 'Loan',
    destination_name: 'Initial balance for "Car"',
    destination_type: 'Liability credit account',
  }
  const savingsTransfer: CsvRow = {
    ...ROW,
    journal_id: '3',
    type: 'Transfer',
    amount: '100.00',
    description: 'To savings',
    source_name: 'Car',
    destination_name: 'Savings',
    destination_type: 'Asset account',
    category: '',
  }

  // An upload batch holds at most 5,000 rows and 650 KB, so the payment lands in a later batch than
  // the one that creates both accounts
  const shopping = Array.from({ length: 5000 }, (_, index) => ({
    ...ROW,
    journal_id: String(index + 10),
    source_name: 'Car',
  }))
  const payment: CsvRow = {
    ...ROW,
    journal_id: '9',
    type: 'Withdrawal',
    amount: '-385.00',
    description: 'Car payment',
    source_name: 'Car',
    destination_name: 'Car',
    destination_type: 'Loan',
    category: '',
  }
  const rows = [openingBalance, loanOpeningBalance, savingsTransfer, ...shopping, payment]
  const accountSources = getFireflyAccountSources(rows)
  const [asset, loan, savings] = accountSources.list
  const prefills = buildFireflyAccountPrefills(rows, accountSources, new Set(['CAD']))
  const accountCreateDetails = Object.fromEntries(accountSources.list.map((source) => [
    source.id,
    { ...prefills[source.id], institutionId: '' },
  ]))
  const accountMappings = {
    [asset.id]: CREATE_ACCOUNT_VALUE,
    [loan.id]: CREATE_ACCOUNT_VALUE,
    [savings.id]: CREATE_ACCOUNT_VALUE,
  }

  it('asks about each account under a label naming its type', () => {
    expect(accountSources.list.map(({ name, label }) => ({ name, label }))).toEqual([
      { name: 'Car', label: 'Car (Asset account)' },
      { name: 'Car', label: 'Car (Loan)' },
      { name: 'Savings', label: 'Savings' },
    ])
    expect([prefills[asset.id].accountType, prefills[loan.id].accountType]).toEqual(['checking', 'loan'])
  })

  it('names each unanswered account by its label', () => {
    const result = buildFireflyImportPayload({
      transactionsFile: TRANSACTIONS_FILE,
      rows,
      accountSources,
      accountMappings: {},
      accountById: new Map(),
      accountCreateDetails,
      importedCategories: ['(no category)', 'Groceries'],
      categoryMappings: { '(no category)': 'misc', Groceries: 'groceries' },
      categoryCreateKinds: {},
      categoryById: new Map(),
    })

    expect(result.errors).toEqual([
      'Map account: Car (Asset account)',
      'Map account: Car (Loan)',
      'Map account: Savings',
    ])
  })

  it('predicts the payment between them as a transfer', () => {
    const resolution = resolveFireflyRowLegs(payment, {
      accountSources,
      accountById: new Map(),
      accountMappings,
      accountCreateDetails,
      institutionById: new Map(),
      categoryById: new Map(),
      categoryMappings: {},
      categoryCreateKinds: {},
      transferCategory: undefined,
      balanceAdjustmentCategory: undefined,
      currencies: CURRENCIES,
    })

    expect(resolution.legs?.map((leg) => leg.amount)).toEqual([-38500, 38500])
  })

  it('creates two accounts and sends the payment between them in a later batch', async () => {
    const result = buildFireflyImportPayload({
      transactionsFile: TRANSACTIONS_FILE,
      rows,
      accountSources,
      accountMappings,
      accountById: new Map(),
      accountCreateDetails,
      importedCategories: ['(no category)', 'Groceries'],
      categoryMappings: { '(no category)': 'misc', Groceries: 'groceries' },
      categoryCreateKinds: {},
      categoryById: new Map(),
    })
    expect(result.errors).toEqual([])

    const createdIds: Record<string, string> = {
      [asset.id]: 'created-asset',
      [loan.id]: 'created-loan',
      [savings.id]: 'created-savings',
    }
    postBatchMock.mockImplementation(async (batch: FireflyTransactionImportPayload) => createImportResult({
      account_source_ids: Object.fromEntries(batch.accounts.map((mapping) => [mapping.source, createdIds[mapping.source]])),
    }))
    await importFireflyTransactionsInBatches(result.payload!)

    const batches = postBatchMock.mock.calls.map(([batch]) => batch as FireflyTransactionImportPayload)
    const lastBatch = batches[batches.length - 1]
    expect(batches.length).toBeGreaterThan(1)
    expect(batches[0].accounts).toEqual([
      { source: asset.id, create: { name: 'Car', account_type: 'checking', currency: 'CAD', institution_id: null } },
      { source: loan.id, create: { name: 'Car', account_type: 'loan', currency: 'CAD', institution_id: null } },
      { source: savings.id, create: { name: 'Savings', account_type: 'checking', currency: 'CAD', institution_id: null } },
    ])
    expect(lastBatch.accounts).toEqual([
      { source: asset.id, account_id: 'created-asset' },
      { source: loan.id, account_id: 'created-loan' },
    ])
    expect(lastBatch.rows.find((row) => row.journal_id === '9')).toMatchObject({
      source_account: asset.id,
      source_name: null,
      destination_account: loan.id,
      destination_name: null,
    })
    expect(lastBatch.rows.find((row) => row.journal_id === '5009')).toMatchObject({
      source_account: asset.id,
      source_name: null,
      destination_account: null,
      destination_name: 'Market',
    })
  })
})

describe('the Firefly row values the payload sends', () => {
  const build = (row: CsvRow, categoryOverrides: Partial<Parameters<typeof buildFireflyImportPayload>[0]> = {}) => (
    buildFireflyImportPayload({
      transactionsFile: TRANSACTIONS_FILE,
      rows: [row],
      accountSources: createNameKeyedAccountSources(['Chequing']),
      accountMappings: { Chequing: CHEQUING.id },
      accountById: new Map([[CHEQUING.id, CHEQUING]]),
      accountCreateDetails: {},
      importedCategories: ['Groceries'],
      categoryMappings: { Groceries: 'groceries' },
      categoryCreateKinds: {},
      categoryById: new Map(),
      ...categoryOverrides,
    })
  )

  // The name of an endpoint the import never writes is left out, so its length cannot fail the batch
  it('sends only the payee name that becomes the merchant', () => {
    const initialBalanceName = `Initial balance for "${'C'.repeat(300)}"`
    const openingBalance: CsvRow = {
      ...ROW,
      type: 'Opening balance',
      source_name: initialBalanceName,
      source_type: 'Initial balance account',
      destination_name: 'Chequing',
      destination_type: 'Asset account',
    }

    const salary: CsvRow = {
      ...ROW,
      type: 'Deposit',
      amount: '2500.00',
      source_name: 'Employer',
      source_type: 'Revenue account',
      destination_name: 'Chequing',
      destination_type: 'Asset account',
    }

    expect(build(ROW).payload?.rows[0]).toMatchObject({ source_name: null, destination_name: 'Market' })
    expect(build(salary).payload?.rows[0]).toMatchObject({ source_name: 'Employer', destination_name: null })
    expect(build(openingBalance).payload?.rows[0]).toMatchObject({ source_name: null, destination_name: null })
  })

  it('sends the foreign amount in place of a main amount in a code Lumina cannot hold', () => {
    const row = { ...ROW, currency_code: 'USDT', foreign_amount: '-16.80', foreign_currency_code: 'cad' }

    expect(build(row).payload?.rows[0]).toMatchObject({
      amount: '-16.80',
      currency_code: 'CAD',
      foreign_amount: null,
      foreign_currency_code: null,
    })
  })

  it('leaves out a foreign amount in a code Lumina cannot hold', () => {
    const row = { ...ROW, foreign_amount: '-9.10', foreign_currency_code: 'USDT' }

    expect(build(row).payload?.rows[0]).toMatchObject({
      amount: '-12.34',
      currency_code: 'CAD',
      foreign_amount: null,
      foreign_currency_code: null,
    })
  })

  it('refuses a new category whose name an existing one holds for the other direction', () => {
    const incomeGroceries = { id: 'groceries', name: 'groceries', kind: 'income', group_id: null, is_system: false } as Category

    const result = build(ROW, {
      categoryMappings: { Groceries: CREATE_CATEGORY_VALUE },
      categoryCreateKinds: { Groceries: 'expense' },
      categoryById: new Map([[incomeGroceries.id, incomeGroceries]]),
    })

    expect(result.payload).toBeNull()
    expect(result.errors).toEqual([
      'groceries already records income, so Groceries cannot be created. Match it to that category, or set its type to income.',
    ])
  })

  // A refund filed as ROAD TRIPS and spending filed as Road Trips each default to a new category
  // of the type their rows vote for, which the backend would fold into one
  it('refuses two new categories that differ only in capitals and are given different types', () => {
    const rows: CsvRow[] = [
      { ...ROW, category: 'Road Trips' },
      {
        ...ROW,
        journal_id: '2',
        type: 'Deposit',
        amount: '80.00',
        source_name: 'Airline',
        source_type: 'Revenue account',
        destination_name: 'Chequing',
        destination_type: 'Asset account',
        category: 'ROAD TRIPS',
      },
    ]
    const importedCategories = getFireflyImportedCategories(rows)
    const categoryCreateKinds = buildFireflyCategoryKinds(rows)

    const result = build(ROW, {
      rows,
      importedCategories,
      categoryMappings: inferFireflyCategoryMappings(importedCategories, {}, [], categoryCreateKinds),
      categoryCreateKinds,
    })

    expect(result.payload).toBeNull()
    expect(result.errors).toEqual(['Road Trips and ROAD TRIPS would be created as one category, so they need the same type.'])
  })
})

// Rows from a real Firefly III 6.7.3 export: a two-way split, a transfer carrying a category, a loan
// payment with no category, and an opening balance
describe('a real Firefly III export with splits, transfers and balance rows', () => {
  const CURRENCIES: Currency[] = [{ id: 'EUR', name: 'Euro', symbol: '€', minor_unit_exponent: 2 }]
  const readExport = () => readFireflyCsvFile(
    new File([readFileSync(new URL('../fixtures/split-and-transfers.csv', import.meta.url), 'utf8')], 'transactions.csv'),
    'transactions',
    new Set(['EUR']),
  )

  const stage = (transactionsFile: ImportFileDraft, rows: CsvRow[]) => stageFireflyImportAsNew(transactionsFile, rows, CURRENCIES)

  it('creates only the categories and accounts the import writes to', async () => {
    const draft = await readExport()
    const openingBalance = draft.rows.find((row) => row.type === 'Opening balance')!
    const rows = [
      ...draft.rows,

      // A category on a balance row is never written, since the row takes Balance Adjustment
      { ...openingBalance, group_id: '40', journal_id: '40', category: 'Starting funds' },

      // A Liability credit is a type the importer skips, so its liability is never written to
      {
        ...openingBalance,
        group_id: '41',
        journal_id: '41',
        type: 'Liability credit',
        description: 'Liability credit for "Mortgage"',
        source_name: 'Liability credit for "Mortgage"',
        source_type: 'Liability credit account',
        destination_name: 'Mortgage',
        destination_type: 'Mortgage',
      },
    ]

    const { options, importedCategories, payload } = stage(draft, rows)

    // Savings plan is carried only by the transfer, and the loan payment is a transfer too
    expect(importedCategories).toEqual(['Groceries', 'Household', '(no category)'])
    expect(payload.categories.map((mapping) => mapping.source)).toEqual(importedCategories)
    expect(options.accountSources.list.map((source) => source.name)).toEqual(['Car Loan', 'Checking', 'Savings'])

    const forecast = forecastFireflyImport(rows, { fileId: draft.id, ...options })
    expect(forecast.skippedRows.map((row) => [row.journalId, row.droppedBeforeUpload])).toEqual([['41', true]])
    expect(payload.rows.find((row) => row.journal_id === '7')?.category).toBeNull()
  })

  it("starts each split's notes with the title of its transaction", async () => {
    const draft = await readExport()
    const { options, payload } = stage(draft, draft.rows)

    expect(payload.rows.map((row) => [row.journal_id, row.notes])).toEqual([
      ['16', null],
      ['14', null],
      ['9', 'Split transaction: Big Store run'],
      ['8', 'Split transaction: Big Store run'],
      ['7', null],
      ['5', null],
      ['1', null],
    ])

    const preview = buildFireflyPreviewRows({ ...options, rows: draft.rows, limit: 10 })
    expect(preview.find((row) => row.id === 'firefly-preview-9-0')?.transaction.notes)
      .toBe('Shop split: home\nSplit transaction: Big Store run')
  })

  // Firefly III keeps the title on a group edited down to one split, and a hand-made file may leave
  // group ids blank, so only a group of more than one row is a split
  it('adds no title to a single journal or to rows without a group id', async () => {
    const draft = await readExport()
    const rows = draft.rows.map((row) => {
      if (row.journal_id === '5') return { ...row, group_title: 'Weekly shop' }
      if (row.journal_id === '16' || row.journal_id === '14') return { ...row, group_id: '', group_title: 'Errands' }
      return row
    })

    const sentNotes = stage(draft, rows).payload.rows
      .filter((row) => ['5', '14', '16'].includes(row.journal_id))
      .map((row) => row.notes)
    expect(sentNotes).toEqual([null, null, null])
  })

  // The endpoint takes the notes a split is sent with, so a title that would take them past its
  // limit is left off rather than failing the batch or dropping the split
  it('leaves the title off a split whose notes would no longer fit with it', async () => {
    const draft = await readExport()
    const titleLength = 'Split transaction: Big Store run\n'.length
    const withNotes = (notes: string) => draft.rows.map((row) => (row.journal_id === '9' ? { ...row, notes } : row))

    const fitting = 'n'.repeat(MAX_IMPORT_NOTES_LENGTH - titleLength)
    const tooLong = 'n'.repeat(MAX_IMPORT_NOTES_LENGTH - titleLength + 1)
    const sentNotes = (rows: CsvRow[]) => stage(draft, rows).payload.rows.find((row) => row.journal_id === '9')?.notes

    expect(sentNotes(withNotes(fitting))).toBe(`Split transaction: Big Store run\n${fitting}`)
    expect(sentNotes(withNotes(tooLong))).toBe(tooLong)
  })

  // An upload batch holds at most 5,000 rows and 650 KB, so the transfers after the spending fill
  // batches of their own
  it('maps no category in a batch holding only transfers', async () => {
    const draft = await readExport()
    const spending = draft.rows.find((row) => row.journal_id === '5')!
    const transfer = draft.rows.find((row) => row.journal_id === '7')!
    const rows = [
      ...draft.rows,
      ...Array.from({ length: 5000 }, (_, index) => ({ ...spending, group_id: String(index + 100), journal_id: String(index + 100) })),
      ...Array.from({ length: 3000 }, (_, index) => ({ ...transfer, group_id: String(index + 6000), journal_id: String(index + 6000) })),
    ]
    const { options, payload } = stage(draft, rows)
    const [, checking, savings] = options.accountSources.list

    postBatchMock.mockReset()
    postBatchMock.mockImplementation(async (batch: FireflyTransactionImportPayload) => createImportResult({
      account_source_ids: Object.fromEntries(batch.accounts.map((mapping) => [mapping.source, `created-${mapping.source}`])),
      category_source_ids: Object.fromEntries(batch.categories.map((mapping) => [mapping.source, `created-${mapping.source}`])),
    }))
    await importFireflyTransactionsInBatches(payload)

    const batches = postBatchMock.mock.calls.map(([batch]) => batch as FireflyTransactionImportPayload)
    const lastBatch = batches[batches.length - 1]
    expect(lastBatch.rows.every((row) => row.type === 'Transfer')).toBe(true)
    expect(lastBatch.categories).toEqual([])
    expect(lastBatch.accounts).toEqual([
      { source: checking.id, account_id: `created-${checking.id}` },
      { source: savings.id, account_id: `created-${savings.id}` },
    ])
  })
})
