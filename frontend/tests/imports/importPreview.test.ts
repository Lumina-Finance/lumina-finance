/**
 * Tests import preview row construction so CSV review catches broken account creation, category creation, tag splitting, and preview capping before import submission
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { Institution } from '@/api/institutions'
import { CREATE_ACCOUNT_VALUE, CREATE_CATEGORY_VALUE, EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import type { ImportFileDraft } from '@/pages/imports/types'
import { buildImportPreviewRows } from '@/pages/imports/utils'

const currencies: Currency[] = [
  { id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
]

const institution: Institution = {
  id: 'bank',
  status: 'active',
  name: 'Bank',
  country_code: 'CA',
  website: 'https://bank.example',
  logo_url: null,
}

/**
 * Creates an account overview fixture for preview account mapping
 */
function createAccount(overrides: Partial<AccountsOverview> = {}): AccountsOverview {
  return {
    id: overrides.id ?? 'checking',
    owner_id: null,
    group_id: null,
    account_kind: 'asset',
    account_type: 'checking',
    tax_advantaged_category_id: null,
    name: overrides.name ?? 'Checking',
    institution: overrides.institution ?? null,
    currency: overrides.currency ?? 'CAD',
    current_balance: 0,
    base_currency_current_balance: 0,
    current_balance_fx_status: { state: 'complete', missing_pairs: [] },
    credit_limit: null,
    is_archived: false,
    closed_at: null,
    ...overrides,
  }
}

/**
 * Creates a category fixture used by preview category mapping
 */
function createCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: overrides.id ?? 'groceries',
    group_id: null,
    owner_id: null,
    name: overrides.name ?? 'Groceries',
    kind: overrides.kind ?? 'expense',
    icon: overrides.icon ?? null,
    is_system: false,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/**
 * Creates an import file draft with mapped CSV headers
 */
function createFile(rows: ImportFileDraft['rows']): ImportFileDraft {
  return {
    id: 'file-1',
    name: 'Checking.csv',
    size: 1024,
    headers: ['Date', 'Amount', 'Category', 'Merchant', 'Notes', 'Tags', 'Currency'],
    hasHeaderRow: true,
    rows,
    error: null,
  }
}

describe('import preview rows', () => {
  it('returns no preview rows until required columns are mapped', () => {
    expect(buildImportPreviewRows({
      files: [createFile([])],
      columnMap: EMPTY_COLUMN_MAP,
      dateFormat: null,
      missingRequiredColumnLabels: ['Date'],
      currencies,
      accountById: new Map(),
      accountCreateCurrencies: {},
      accountCreateInstitutions: {},
      categoryById: new Map(),
      categoryCreateKinds: {},
      categoryTypesBySource: {},
      institutionById: new Map(),
      resolvedAccountMappings: {},
      resolvedCategoryMappings: {},
    })).toEqual([])
  })

  it('builds create-account preview rows with created categories, tags, and minor-unit amounts', () => {
    const rows = buildImportPreviewRows({
      files: [createFile([{
        Date: '06/11/2026',
        Amount: '-12.34',
        Category: 'Groceries',
        Merchant: 'Market',
        Notes: 'Weekly shop',
        Tags: 'food, essentials',
        Currency: '',
      }])],
      columnMap: {
        ...EMPTY_COLUMN_MAP,
        dt: 'Date',
        amount: 'Amount',
        category_id: 'Category',
        merchant_id: 'Merchant',
        notes: 'Notes',
        tag_ids: 'Tags',
        currency: 'Currency',
      },
      dateFormat: 'monthFirst',
      missingRequiredColumnLabels: [],
      currencies,
      accountById: new Map(),
      accountCreateCurrencies: { 'file-1': 'USD' },
      accountCreateInstitutions: { 'file-1': 'bank' },
      categoryById: new Map(),
      categoryCreateKinds: { Groceries: 'expense' },
      categoryTypesBySource: {},
      institutionById: new Map([[institution.id, institution]]),
      resolvedAccountMappings: { 'file-1': CREATE_ACCOUNT_VALUE },
      resolvedCategoryMappings: { Groceries: CREATE_CATEGORY_VALUE },
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      accountInstitution: institution,
      accountName: 'Checking',
      currency: 'USD',
      dateLabel: 'June 11, 2026',
      category: {
        name: 'Groceries',
        kind: 'expense',
      },
      transaction: {
        account_id: CREATE_ACCOUNT_VALUE,
        amount: -1234,
        merchant_name: 'Market',
        notes: 'Weekly shop',
        tags: [
          { name: 'food' },
          { name: 'essentials' },
        ],
      },
    })
  })

  it('caps preview rows to the first five mapped transactions', () => {
    const category = createCategory()
    const file = createFile(Array.from({ length: 6 }, (_, index) => ({
      Date: `2026-06-${String(index + 1).padStart(2, '0')}`,
      Amount: '1.00',
      Category: 'Groceries',
      Merchant: '',
      Notes: '',
      Tags: '',
      Currency: '',
    })))

    const rows = buildImportPreviewRows({
      files: [file],
      columnMap: {
        ...EMPTY_COLUMN_MAP,
        dt: 'Date',
        amount: 'Amount',
        category_id: 'Category',
      },
      dateFormat: 'yearFirst',
      missingRequiredColumnLabels: [],
      currencies,
      accountById: new Map([['checking', createAccount()]]),
      accountCreateCurrencies: {},
      accountCreateInstitutions: {},
      categoryById: new Map([[category.id, category]]),
      categoryCreateKinds: {},
      categoryTypesBySource: {},
      institutionById: new Map(),
      resolvedAccountMappings: { 'file-1': 'checking' },
      resolvedCategoryMappings: { Groceries: category.id },
    })

    expect(rows).toHaveLength(5)
    expect(rows.at(-1)?.transaction.dt).toBe('2026-06-05')
  })
})
