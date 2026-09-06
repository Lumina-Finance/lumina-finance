/**
 * Tests the CSV import's answer to where a transfer's money went, so a mapped counterparty-account
 * column reaches the payload and the preview, and a row that cannot record one is refused before
 * upload
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import {
  CREATE_ACCOUNT_VALUE,
  CREATE_CATEGORY_VALUE,
  EMPTY_COLUMN_MAP,
  ROW_COUNTERPARTY_IS_OWN_ACCOUNT_REASON,
  ROW_COUNTERPARTY_NOT_A_TRANSFER_REASON,
} from '@/pages/imports/constants'
import { OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import type { ColumnMap, ImportAccountSource, ImportCategoryKind, ImportFileDraft } from '@/pages/imports/types'
import { buildImportAccountMappingSources, buildImportPreviewRows, buildTransactionImportPayload } from '@/pages/imports/utils'

const currencies: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
]

const COLUMN_MAP: ColumnMap = {
  ...EMPTY_COLUMN_MAP,
  account_id: 'Account',
  dt: 'Date',
  amount: 'Amount',
  category_id: 'Category',
  counterparty_account_id: 'Other account',
}

const TRANSFER: Category = {
  id: 'transfer',
  group_id: null,
  owner_id: null,
  name: 'Transfer',
  kind: 'transfer',
  icon: null,
  is_system: true,
  created_at: '2026-01-01T00:00:00Z',
}

const GROCERIES: Category = { ...TRANSFER, id: 'groceries', name: 'Groceries', kind: 'expense', is_system: false }
const BALANCE_ADJUSTMENT: Category = { ...TRANSFER, id: 'balance-adjustment', name: 'Balance Adjustment' }

/**
 * Creates an account fixture the mapping choices resolve to
 */
function createAccount(id: string, name: string): AccountsOverview {
  return {
    id,
    owner_id: null,
    group_id: null,
    account_kind: 'asset',
    account_type: 'checking',
    tax_advantaged_category_id: null,
    name,
    institution: null,
    currency: 'CAD',
    current_balance: 0,
    base_currency_current_balance: 0,
    current_balance_fx_status: { state: 'complete', missing_pairs: [] },
    credit_limit: null,
    can_write: true,
    is_archived: false,
    closed_at: null,
  }
}

const CHEQUING = createAccount('chequing', 'Chequing')
const SAVINGS = createAccount('savings', 'Savings')
const ARCHIVED_SAVINGS = { ...createAccount('archived-savings', 'Old Savings'), is_archived: true }
const ACCOUNTS_BY_ID = new Map([
  [CHEQUING.id, CHEQUING],
  [SAVINGS.id, SAVINGS],
  [ARCHIVED_SAVINGS.id, ARCHIVED_SAVINGS],
])

/**
 * Creates a one-file draft whose rows carry the mapped headers
 */
function createFile(rows: ImportFileDraft['rows']): ImportFileDraft {
  return {
    id: 'file-1',
    name: 'Chequing.csv',
    size: 1024,
    headers: ['Account', 'Date', 'Amount', 'Category', 'Other account'],
    hasHeaderRow: true,
    rows,
    error: null,
  }
}

/**
 * Creates the account sources a mapped counterparty-account column produces, with the row's own
 * account first and the counterparty after it
 */
function createSources(counterpartyLabel: string): ImportAccountSource[] {
  return [
    { id: 'Chequing', label: 'Chequing', matchText: 'Chequing', isCounterpartyOnly: false },
    { id: counterpartyLabel, label: counterpartyLabel, matchText: counterpartyLabel, isCounterpartyOnly: true },
  ]
}

/**
 * Builds the commit payload for one transfer row against the given mappings
 */
function buildPayload({
  accountMappings,
  accountCreateTypes = {},
  accountCreateCurrencies = {},
  categoryById = new Map([[TRANSFER.id, TRANSFER]]),
  categoryMappings = { Transfer: TRANSFER.id },
  categoryCreateKinds = {},
  categorySource = 'Transfer',
  counterpartyAccountSource = 'Savings',
  accountSources = createSources('Savings'),
}: {
  accountMappings: Record<string, string>
  accountCreateTypes?: Record<string, string>
  accountCreateCurrencies?: Record<string, string>
  categoryById?: Map<string, Category>
  categoryMappings?: Record<string, string>
  categoryCreateKinds?: Record<string, ImportCategoryKind>
  categorySource?: string
  counterpartyAccountSource?: string
  accountSources?: ImportAccountSource[]
}) {
  return buildTransactionImportPayload({
    accountById: ACCOUNTS_BY_ID,
    accountCreateCurrencies,
    accountCreateInstitutions: {},
    accountCreateTypes,
    accountMappings,
    accountSources,
    currencies,
    categoryById,
    categoryCreateKinds,
    categoryMappings,
    categoryTypesBySource: {},
    columnMap: COLUMN_MAP,
    columnValidationErrors: {},
    dateFormat: 'yearFirst',
    directionAnswers: {},
    files: [createFile([{
      Account: 'Chequing',
      Date: '2026-04-11',
      Amount: '-500.00',
      Category: categorySource,
      'Other account': counterpartyAccountSource,
    }])],
    importedCategories: [categorySource],
  })
}

describe('CSV import counterparty account', () => {
  it('keeps a source with rows of its own out of the counterparty group', () => {
    const files = [createFile([
      { Account: 'Chequing', Date: '2026-04-11', Amount: '-500.00', Category: 'Transfer', 'Other account': 'Savings' },
      { Account: 'Savings', Date: '2026-04-13', Amount: '500.00', Category: 'Transfer', 'Other account': '' },
    ])]

    // Savings is written to by the second row, so it stays an ordinary source despite also being
    // named as the counterparty of the first
    expect(buildImportAccountMappingSources(files, 'Account', 'Other account')).toEqual([
      { id: 'Chequing', label: 'Chequing', matchText: 'Chequing', isCounterpartyOnly: false },
      { id: 'Savings', label: 'Savings', matchText: 'Savings', isCounterpartyOnly: false },
    ])
  })

  it('marks a name appearing only as the counterparty', () => {
    const files = [createFile([
      { Account: 'Chequing', Date: '2026-04-11', Amount: '-500.00', Category: 'Transfer', 'Other account': 'Brokerage elsewhere' },
    ])]

    expect(buildImportAccountMappingSources(files, 'Account', 'Other account')).toEqual([
      { id: 'Chequing', label: 'Chequing', matchText: 'Chequing', isCounterpartyOnly: false },
      { id: 'Brokerage elsewhere', label: 'Brokerage elsewhere', matchText: 'Brokerage elsewhere', isCounterpartyOnly: true },
    ])
  })

  it('carries the counterparty account source onto the row', () => {
    const { errors, payload } = buildPayload({
      accountMappings: { Chequing: CHEQUING.id, Savings: SAVINGS.id },
    })

    expect(errors).toEqual([])
    expect(payload?.rows[0].counterparty_account_source).toBe('Savings')
    expect(payload?.accounts).toContainEqual({ source: 'Savings', account_id: SAVINGS.id })
  })

  it('sends the outside answer as a mapping rather than an account', () => {
    const { errors, payload } = buildPayload({
      accountMappings: { Chequing: CHEQUING.id, 'Brokerage elsewhere': OUTSIDE_ACCOUNT_VALUE },
      counterpartyAccountSource: 'Brokerage elsewhere',
      accountSources: createSources('Brokerage elsewhere'),
    })

    expect(errors).toEqual([])
    expect(payload?.accounts).toContainEqual({ source: 'Brokerage elsewhere', outside: true })
    expect(payload?.rows[0].counterparty_account_source).toBe('Brokerage elsewhere')
  })

  it('records an archived account as a counterparty, and refuses one for a source rows are written to', () => {
    const counterparty = buildPayload({
      accountMappings: { Chequing: CHEQUING.id, Savings: ARCHIVED_SAVINGS.id },
    })

    expect(counterparty.errors).toEqual([])
    expect(counterparty.payload?.accounts).toContainEqual({ source: 'Savings', account_id: ARCHIVED_SAVINGS.id })

    // The same answer on a source rows are written to is what mapping the account column at that
    // column afterwards leaves behind, and the API refuses it
    const rowAccount = buildPayload({
      accountMappings: { Chequing: ARCHIVED_SAVINGS.id, Savings: SAVINGS.id },
    })

    expect(rowAccount.payload).toBeNull()
    expect(rowAccount.errors).toContain('Map to an account that is not archived: Chequing')
  })

  it('refuses the outside answer for a source rows are written to', () => {
    const { errors, payload } = buildPayload({
      accountMappings: { Chequing: OUTSIDE_ACCOUNT_VALUE, Savings: SAVINGS.id },
    })

    expect(payload).toBeNull()
    expect(errors).toContain('Map to one of your accounts: Chequing has rows of its own, so it cannot be answered as outside.')
  })

  it('refuses a counterparty account on a row that is not a transfer', () => {
    const { payload, rowProblems } = buildPayload({
      accountMappings: { Chequing: CHEQUING.id, Savings: SAVINGS.id },
      categoryById: new Map([[GROCERIES.id, GROCERIES]]),
      categoryMappings: { Groceries: GROCERIES.id },
      categorySource: 'Groceries',
    })

    expect(payload).toBeNull()
    expect(rowProblems.map((problem) => problem.reason)).toEqual([ROW_COUNTERPARTY_NOT_A_TRANSFER_REASON])
  })

  it('refuses a counterparty account on a balance adjustment, which has no counterparty', () => {
    const { payload, rowProblems } = buildPayload({
      accountMappings: { Chequing: CHEQUING.id, Savings: SAVINGS.id },
      categoryById: new Map([[BALANCE_ADJUSTMENT.id, BALANCE_ADJUSTMENT]]),
      categoryMappings: { 'Balance Adjustment': BALANCE_ADJUSTMENT.id },
      categorySource: 'Balance Adjustment',
    })

    expect(payload).toBeNull()
    expect(rowProblems.map((problem) => problem.reason)).toEqual([ROW_COUNTERPARTY_NOT_A_TRANSFER_REASON])
  })

  it('refuses a counterparty account on a balance adjustment reached under a different capitalisation', () => {
    // The commit reuses a category of the same name whatever its capitals, so a file spelling it
    // BALANCE ADJUSTMENT lands on the one that records no counterparty account. Judging the row
    // against the name in the file instead let it through here and had the commit refuse the file
    const { payload, rowProblems } = buildPayload({
      accountMappings: { Chequing: CHEQUING.id, Savings: SAVINGS.id },
      categoryById: new Map([[BALANCE_ADJUSTMENT.id, BALANCE_ADJUSTMENT]]),
      categoryMappings: { 'BALANCE ADJUSTMENT': CREATE_CATEGORY_VALUE },
      categoryCreateKinds: { 'BALANCE ADJUSTMENT': 'transfer' },
      categorySource: 'BALANCE ADJUSTMENT',
    })

    expect(payload).toBeNull()
    expect(rowProblems.map((problem) => problem.reason)).toEqual([ROW_COUNTERPARTY_NOT_A_TRANSFER_REASON])
  })

  it('refuses a transfer whose two sources were mapped onto one account', () => {
    const { payload, rowProblems } = buildPayload({
      accountMappings: { Chequing: CHEQUING.id, 'Chequing (old)': CHEQUING.id },
      counterpartyAccountSource: 'Chequing (old)',
      accountSources: createSources('Chequing (old)'),
    })

    expect(payload).toBeNull()

    // The entry carries which row it was, so a file of thousands says which one to go and correct
    expect(rowProblems).toEqual([{
      id: 'file-1-0',
      rowNumber: 1,
      cells: {
        Account: 'Chequing',
        Date: '2026-04-11',
        Amount: '-500.00',
        Category: 'Transfer',
        'Other account': 'Chequing (old)',
      },
      reason: ROW_COUNTERPARTY_IS_OWN_ACCOUNT_REASON,
    }])
  })

  // One name in both columns is one source and one account, whichever way it is mapped, so the
  // account queued for creation is no escape from the rule
  it('refuses a transfer whose counterparty is its own source, even for an account queued for creation', () => {
    const { payload, rowProblems } = buildPayload({
      accountMappings: { Chequing: CREATE_ACCOUNT_VALUE },
      accountCreateTypes: { Chequing: 'checking' },
      accountCreateCurrencies: { Chequing: 'CAD' },
      counterpartyAccountSource: 'Chequing',
      accountSources: [{ id: 'Chequing', label: 'Chequing', matchText: 'Chequing', isCounterpartyOnly: false }],
    })

    expect(payload).toBeNull()
    expect(rowProblems.map((problem) => problem.reason)).toEqual([ROW_COUNTERPARTY_IS_OWN_ACCOUNT_REASON])
  })

  it('shows what each answer writes in the preview', () => {
    const rows = buildImportPreviewRows({
      files: [createFile([
        { Account: 'Chequing', Date: '2026-04-11', Amount: '-500.00', Category: 'Transfer', 'Other account': 'Savings' },
        { Account: 'Chequing', Date: '2026-04-12', Amount: '-25.00', Category: 'Transfer', 'Other account': 'Brokerage elsewhere' },
        { Account: 'Chequing', Date: '2026-04-13', Amount: '-30.00', Category: 'Transfer', 'Other account': '' },
      ])],
      columnMap: COLUMN_MAP,
      dateFormat: 'yearFirst',
      directionAnswers: {},
      missingRequiredColumnLabels: [],
      currencies,
      accountById: new Map([[CHEQUING.id, CHEQUING], [SAVINGS.id, SAVINGS]]),
      accountCreateCurrencies: {},
      accountCreateInstitutions: {},
      categoryById: new Map([[TRANSFER.id, TRANSFER]]),
      categoryCreateKinds: {},
      categoryTypesBySource: {},
      institutionById: new Map(),
      resolvedAccountMappings: {
        Chequing: CHEQUING.id,
        Savings: SAVINGS.id,
        'Brokerage elsewhere': OUTSIDE_ACCOUNT_VALUE,
      },
      resolvedCategoryMappings: { Transfer: TRANSFER.id },
      rowProblems: [],
    })

    expect(rows.map((row) => [row.transaction.counterparty_account_id, row.transaction.counterparty_account_scope])).toEqual([
      [SAVINGS.id, 'tracked'],
      [null, 'outside'],

      // Nothing in the file points this transfer at an account, so it records the money as leaving
      [null, 'outside'],
    ])

    // The row renders the name, which the preview has to carry itself because it reads no account list
    expect(rows[0].counterpartyAccountName).toBe('Savings')
  })

  // A counterparty source loses its answer when the account it was matched to is deleted, and the
  // step then holds it blank rather than falling back to the outside answer. The preview has to
  // hold the same line, or it states money leaving for a row the commit is about to refuse
  it('previews a counterparty source with no answer as unanswered rather than as money leaving', () => {
    const rows = buildImportPreviewRows({
      files: [createFile([
        { Account: 'Chequing', Date: '2026-04-11', Amount: '-500.00', Category: 'Transfer', 'Other account': 'Savings' },
      ])],
      columnMap: COLUMN_MAP,
      dateFormat: 'yearFirst',
      directionAnswers: {},
      missingRequiredColumnLabels: [],
      currencies,
      accountById: new Map([[CHEQUING.id, CHEQUING]]),
      accountCreateCurrencies: {},
      accountCreateInstitutions: {},
      categoryById: new Map([[TRANSFER.id, TRANSFER]]),
      categoryCreateKinds: {},
      categoryTypesBySource: {},
      institutionById: new Map(),

      // Savings was answered, then the account was deleted, so the source carries no answer at all
      resolvedAccountMappings: { Chequing: CHEQUING.id },

      resolvedCategoryMappings: { Transfer: TRANSFER.id },
      rowProblems: [],
    })

    expect(rows[0].transaction.counterparty_account_scope).toBeNull()
    expect(rows[0].transaction.counterparty_account_id).toBeNull()
  })

  it('previews a row whose category cannot record a counterparty account as unanswered', () => {
    const rows = buildImportPreviewRows({
      files: [createFile([
        { Account: 'Chequing', Date: '2026-04-11', Amount: '-12.00', Category: 'Groceries', 'Other account': 'Savings' },
      ])],
      columnMap: COLUMN_MAP,
      dateFormat: 'yearFirst',
      directionAnswers: {},
      missingRequiredColumnLabels: [],
      currencies,
      accountById: new Map([[CHEQUING.id, CHEQUING], [SAVINGS.id, SAVINGS]]),
      accountCreateCurrencies: {},
      accountCreateInstitutions: {},
      categoryById: new Map([[GROCERIES.id, GROCERIES]]),
      categoryCreateKinds: {},
      categoryTypesBySource: {},
      institutionById: new Map(),
      resolvedAccountMappings: { Chequing: CHEQUING.id, Savings: SAVINGS.id },
      resolvedCategoryMappings: { Groceries: GROCERIES.id },
      rowProblems: [],
    })

    expect(rows[0].transaction.counterparty_account_id).toBeNull()
    expect(rows[0].transaction.counterparty_account_scope).toBeNull()
  })

  it('shows a transfer into an account queued for creation under the source it came from', () => {
    const rows = buildImportPreviewRows({
      files: [createFile([
        { Account: 'Chequing', Date: '2026-04-11', Amount: '-500.00', Category: 'Transfer', 'Other account': 'Savings' },
      ])],
      columnMap: COLUMN_MAP,
      dateFormat: 'yearFirst',
      directionAnswers: {},
      missingRequiredColumnLabels: [],
      currencies,
      accountById: new Map([[CHEQUING.id, CHEQUING]]),
      accountCreateCurrencies: {},
      accountCreateInstitutions: {},
      categoryById: new Map([[TRANSFER.id, TRANSFER]]),
      categoryCreateKinds: {},
      categoryTypesBySource: {},
      institutionById: new Map(),
      resolvedAccountMappings: { Chequing: CHEQUING.id, Savings: CREATE_ACCOUNT_VALUE },
      resolvedCategoryMappings: { Transfer: TRANSFER.id },
      rowProblems: [],
    })

    // The import writes the new account's id, which does not exist yet, so the preview stands in
    // with the same sentinel it already uses for the row's own account
    expect(rows[0].transaction.counterparty_account_scope).toBe('tracked')
    expect(rows[0].transaction.counterparty_account_id).toBe(CREATE_ACCOUNT_VALUE)
    expect(rows[0].counterpartyAccountName).toBe('Savings')
  })
})
