/**
 * Tests the CSV import's answer to where a transfer's money went, so a mapped other-account column reaches the payload and the preview, and a row that cannot record one is refused before upload
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import { CREATE_ACCOUNT_VALUE, EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import { OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import type { ColumnMap, ImportAccountSource, ImportFileDraft } from '@/pages/imports/types'
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
  other_account_id: 'Other account',
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
    is_archived: false,
    closed_at: null,
  }
}

const CHEQUING = createAccount('chequing', 'Chequing')
const SAVINGS = createAccount('savings', 'Savings')

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
 * Creates the account sources a mapped other-account column produces, with the row's own account
 * first and the other side after it
 */
function createSources(otherSideLabel: string): ImportAccountSource[] {
  return [
    { id: 'Chequing', label: 'Chequing', matchText: 'Chequing', isOtherSideOnly: false },
    { id: otherSideLabel, label: otherSideLabel, matchText: otherSideLabel, isOtherSideOnly: true },
  ]
}

/**
 * Builds the commit payload for one transfer row against the given mappings
 */
function buildPayload({
  accountMappings,
  categoryById = new Map([[TRANSFER.id, TRANSFER]]),
  categoryMappings = { Transfer: TRANSFER.id },
  categorySource = 'Transfer',
  otherAccountSource = 'Savings',
  accountSources = createSources('Savings'),
}: {
  accountMappings: Record<string, string>
  categoryById?: Map<string, Category>
  categoryMappings?: Record<string, string>
  categorySource?: string
  otherAccountSource?: string
  accountSources?: ImportAccountSource[]
}) {
  return buildTransactionImportPayload({
    accountCreateCurrencies: {},
    accountCreateInstitutions: {},
    accountCreateTypes: {},
    accountMappings,
    accountSources,
    categoryById,
    categoryCreateKinds: {},
    categoryMappings,
    categoryTypesBySource: {},
    columnMap: COLUMN_MAP,
    columnValidationErrors: {},
    dateFormat: 'yearFirst',
    files: [createFile([{
      Account: 'Chequing',
      Date: '2026-04-11',
      Amount: '-500.00',
      Category: categorySource,
      'Other account': otherAccountSource,
    }])],
    importedCategories: [categorySource],
  })
}

describe('CSV import other account', () => {
  it('keeps a source with rows of its own out of the other-side group', () => {
    const files = [createFile([
      { Account: 'Chequing', Date: '2026-04-11', Amount: '-500.00', Category: 'Transfer', 'Other account': 'Savings' },
      { Account: 'Savings', Date: '2026-04-13', Amount: '500.00', Category: 'Transfer', 'Other account': '' },
    ])]

    // Savings is written to by the second row, so it stays an ordinary source despite also being
    // named as the other side of the first
    expect(buildImportAccountMappingSources(files, 'Account', 'Other account')).toEqual([
      { id: 'Chequing', label: 'Chequing', matchText: 'Chequing', isOtherSideOnly: false },
      { id: 'Savings', label: 'Savings', matchText: 'Savings', isOtherSideOnly: false },
    ])
  })

  it('marks a name appearing only as the other side', () => {
    const files = [createFile([
      { Account: 'Chequing', Date: '2026-04-11', Amount: '-500.00', Category: 'Transfer', 'Other account': 'Brokerage elsewhere' },
    ])]

    expect(buildImportAccountMappingSources(files, 'Account', 'Other account')).toEqual([
      { id: 'Chequing', label: 'Chequing', matchText: 'Chequing', isOtherSideOnly: false },
      { id: 'Brokerage elsewhere', label: 'Brokerage elsewhere', matchText: 'Brokerage elsewhere', isOtherSideOnly: true },
    ])
  })

  it('carries the other account source onto the row', () => {
    const { errors, payload } = buildPayload({
      accountMappings: { Chequing: CHEQUING.id, Savings: SAVINGS.id },
    })

    expect(errors).toEqual([])
    expect(payload?.rows[0].other_account_source).toBe('Savings')
    expect(payload?.accounts).toContainEqual({ source: 'Savings', account_id: SAVINGS.id })
  })

  it('sends the outside answer as a mapping rather than an account', () => {
    const { errors, payload } = buildPayload({
      accountMappings: { Chequing: CHEQUING.id, 'Brokerage elsewhere': OUTSIDE_ACCOUNT_VALUE },
      otherAccountSource: 'Brokerage elsewhere',
      accountSources: createSources('Brokerage elsewhere'),
    })

    expect(errors).toEqual([])
    expect(payload?.accounts).toContainEqual({ source: 'Brokerage elsewhere', outside: true })
    expect(payload?.rows[0].other_account_source).toBe('Brokerage elsewhere')
  })

  it('refuses the outside answer for a source rows are written to', () => {
    const { errors, payload } = buildPayload({
      accountMappings: { Chequing: OUTSIDE_ACCOUNT_VALUE, Savings: SAVINGS.id },
    })

    expect(payload).toBeNull()
    expect(errors).toContain('Rows cannot be written to an account source that is outside the tracked accounts: Chequing')
  })

  it('refuses an other account on a row that is not a transfer', () => {
    const { errors, payload } = buildPayload({
      accountMappings: { Chequing: CHEQUING.id, Savings: SAVINGS.id },
      categoryById: new Map([[GROCERIES.id, GROCERIES]]),
      categoryMappings: { Groceries: GROCERIES.id },
      categorySource: 'Groceries',
    })

    expect(payload).toBeNull()
    expect(errors).toContain('Only a transfer records an other account, so the mapped Other account column cannot be used by category: Groceries')
  })

  it('refuses an other account on a balance adjustment, which has no other side', () => {
    const { errors, payload } = buildPayload({
      accountMappings: { Chequing: CHEQUING.id, Savings: SAVINGS.id },
      categoryById: new Map([[BALANCE_ADJUSTMENT.id, BALANCE_ADJUSTMENT]]),
      categoryMappings: { 'Balance Adjustment': BALANCE_ADJUSTMENT.id },
      categorySource: 'Balance Adjustment',
    })

    expect(payload).toBeNull()
    expect(errors).toContain('Only a transfer records an other account, so the mapped Other account column cannot be used by category: Balance Adjustment')
  })

  it('refuses a transfer whose two sources were mapped onto one account', () => {
    const { errors, payload } = buildPayload({
      accountMappings: { Chequing: CHEQUING.id, 'Chequing (old)': CHEQUING.id },
      otherAccountSource: 'Chequing (old)',
      accountSources: createSources('Chequing (old)'),
    })

    expect(payload).toBeNull()
    expect(errors).toContain('A transfer cannot record its own account as the other side: Chequing (old)')
  })

  // One name in both columns is one source and one account, whichever way it is mapped, so the
  // account queued for creation is no escape from the rule
  it('refuses a transfer whose other side is its own source, even for an account queued for creation', () => {
    const { errors, payload } = buildPayload({
      accountMappings: { Chequing: CREATE_ACCOUNT_VALUE },
      otherAccountSource: 'Chequing',
      accountSources: [{ id: 'Chequing', label: 'Chequing', matchText: 'Chequing', isOtherSideOnly: false }],
    })

    expect(payload).toBeNull()
    expect(errors).toContain('A transfer cannot record its own account as the other side: Chequing')
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
    })

    expect(rows.map((row) => [row.transaction.other_account_id, row.transaction.other_account_scope])).toEqual([
      [SAVINGS.id, 'tracked'],
      [null, 'outside'],
      [null, null],
    ])

    // The row renders the name, which the preview has to carry itself because it reads no account list
    expect(rows[0].otherAccountName).toBe('Savings')
  })

  it('previews a row whose category cannot record an other account as unanswered', () => {
    const rows = buildImportPreviewRows({
      files: [createFile([
        { Account: 'Chequing', Date: '2026-04-11', Amount: '-12.00', Category: 'Groceries', 'Other account': 'Savings' },
      ])],
      columnMap: COLUMN_MAP,
      dateFormat: 'yearFirst',
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
    })

    expect(rows[0].transaction.other_account_id).toBeNull()
    expect(rows[0].transaction.other_account_scope).toBeNull()
  })

  it('shows a transfer into an account queued for creation under the source it came from', () => {
    const rows = buildImportPreviewRows({
      files: [createFile([
        { Account: 'Chequing', Date: '2026-04-11', Amount: '-500.00', Category: 'Transfer', 'Other account': 'Savings' },
      ])],
      columnMap: COLUMN_MAP,
      dateFormat: 'yearFirst',
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
    })

    // The import writes the new account's id, which does not exist yet, so the preview stands in
    // with the same sentinel it already uses for the row's own account
    expect(rows[0].transaction.other_account_scope).toBe('tracked')
    expect(rows[0].transaction.other_account_id).toBe(CREATE_ACCOUNT_VALUE)
    expect(rows[0].otherAccountName).toBe('Savings')
  })
})
