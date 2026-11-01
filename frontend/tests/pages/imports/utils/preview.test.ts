/**
 * Tests import preview row construction so CSV review catches broken account creation, category creation, tag splitting, and preview capping before import submission
 */
import { describe, expect, it, vi } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { Institution } from '@/api/institutions'
import {
  CREATE_ACCOUNT_VALUE,
  CREATE_CATEGORY_VALUE,
  EMPTY_COLUMN_MAP,
  SKIP_TAG_VALUE,
} from '@/pages/imports/constants'
import type { ImportFileDraft } from '@/pages/imports/types'
import { buildImportPreviewRows, WHOLE_FILE_DATE_RANGE } from '@/pages/imports/utils'

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
    can_write: true,
    is_archived: false,
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
 *
 * @param headers - What the file's columns are called, for a file carrying one the usual set does
 * not, since a column absent from this list is invisible to everything that reads a row
 */
function createFile(
  rows: ImportFileDraft['rows'],
  headers = ['Date', 'Amount', 'Category', 'Merchant', 'Notes', 'Tags', 'Currency'],
): ImportFileDraft {
  return {
    id: 'file-1',
    name: 'Checking.csv',
    size: 1024,
    headers,
    hasHeaderRow: true,
    rows,
    error: null,
  }
}

describe('import preview rows', () => {
  it('previews timestamps in the profile zone with the same financial fields as plain dates', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-18T12:00:00Z'))
    try {
      const category = createCategory()
      const account = createAccount()
      const options = {
        columnMap: { ...EMPTY_COLUMN_MAP, dt: 'Date', amount: 'Amount', category_id: 'Category' },
        dateRange: WHOLE_FILE_DATE_RANGE,
        directionAnswers: {},
        missingRequiredColumnLabels: [],
        currencies,
        accountById: new Map([[account.id, account]]),
        accountCreateCurrencies: {},
        accountCreateInstitutions: {},
        categoryById: new Map([[category.id, category]]),
        categoryCreateKinds: {},
        categoryTypesBySource: {},
        institutionById: new Map(),
        resolvedAccountMappings: { 'file-1': account.id },
        resolvedCategoryMappings: { Groceries: category.id },
        rowProblems: [],
      }
      const values = ['2024-03-15T00:30:00Z', '2024-03-16T00:30:00+09:00', '2024-03-17T23:30:00-04:00']
      const dates = ['2024-03-15', '2024-03-16', '2024-03-18']
      const makeRows = (dates: string[]) =>
        createFile(dates.map((Date) => ({ Date, Amount: '-12.34', Category: 'Groceries' })))
      const rows = buildImportPreviewRows({
        ...options,
        files: [makeRows(values)],
        dateFormat: 'iso',
        dateSeparator: '.',
        timeZone: 'Asia/Tokyo',
      })
      const plainRows = buildImportPreviewRows({ ...options, files: [makeRows(dates)], dateFormat: 'yearFirst' })
      expect(rows).toEqual(plainRows)
      expect(rows.map((row) => row.transaction.dt)).toEqual(dates)
      expect(rows.map((row) => row.transaction.amount)).toEqual([-1234n, -1234n, -1234n])
    } finally {
      vi.useRealTimers()
    }
  })
  it('returns no preview rows until required columns are mapped', () => {
    expect(
      buildImportPreviewRows({
        files: [createFile([])],
        columnMap: EMPTY_COLUMN_MAP,
        dateFormat: null,
        dateRange: WHOLE_FILE_DATE_RANGE,
        directionAnswers: {},
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
        rowProblems: [],
      }),
    ).toEqual([])
  })

  it('builds create-account preview rows with created categories, tags, and minor-unit amounts', () => {
    const rows = buildImportPreviewRows({
      files: [
        createFile([
          {
            Date: '06/11/2026',
            Amount: '-12.34',
            Category: 'Groceries',
            Merchant: 'Market',
            Notes: 'Weekly shop',
            Tags: 'food, essentials',
            Currency: '',
          },
        ]),
      ],
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
      dateRange: WHOLE_FILE_DATE_RANGE,
      directionAnswers: {},
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
      rowProblems: [],
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
        icon: '🏷️',
      },
      transaction: {
        id: 'import-preview-file-1-0',
        account_id: CREATE_ACCOUNT_VALUE,
        amount: -1234n,
        account_amount: -1234n,
        fx_rate: null,
        merchant_id: 'import-preview-file-1-0-merchant',
        merchant_name: 'Market',
        notes: 'Weekly shop',
        tag_ids: ['import-preview-file-1-0-tag-0-food', 'import-preview-file-1-0-tag-1-essentials'],
        tags: [{ name: 'food' }, { name: 'essentials' }],
      },
    })
  })

  // The preview and the commit read a row the same way, so a file whose direction is a column of
  // words has to be shown signed here or the user would approve rows the import writes differently
  it('shows a row signed from the word its direction column carries', () => {
    const category = createCategory()
    const account = createAccount()
    const rows = buildImportPreviewRows({
      files: [
        createFile(
          [
            {
              Date: '2026-06-11',
              Amount: '84.20',
              Category: 'Groceries',
              Merchant: '',
              Notes: '',
              Tags: '',
              Currency: '',
              Type: 'DEBIT',
            },
          ],
          ['Date', 'Amount', 'Category', 'Merchant', 'Notes', 'Tags', 'Currency', 'Type'],
        ),
      ],
      columnMap: {
        ...EMPTY_COLUMN_MAP,
        dt: 'Date',
        amount: 'Amount',
        category_id: 'Category',
        amount_direction: 'Type',
      },
      dateFormat: 'yearFirst',
      dateRange: WHOLE_FILE_DATE_RANGE,
      directionAnswers: { debit: 'out' },
      missingRequiredColumnLabels: [],
      currencies,
      accountById: new Map([[account.id, account]]),
      accountCreateCurrencies: {},
      accountCreateInstitutions: {},
      categoryById: new Map([[category.id, category]]),
      categoryCreateKinds: {},
      categoryTypesBySource: {},
      institutionById: new Map(),
      resolvedAccountMappings: { 'file-1': account.id },
      resolvedCategoryMappings: { Groceries: category.id },
      rowProblems: [],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].transaction.amount).toBe(-8420n)
  })

  it('previews the same normalized amount that the payload receives', () => {
    const category = createCategory()
    const account = createAccount()
    const rows = buildImportPreviewRows({
      files: [
        createFile([
          {
            Date: '31.08.2026',
            Amount: '-CHF100,99',
            Category: 'Groceries',
            Merchant: '',
            Notes: '',
            Tags: '',
            Currency: '',
          },
        ]),
      ],
      columnMap: { ...EMPTY_COLUMN_MAP, dt: 'Date', amount: 'Amount', category_id: 'Category' },
      dateFormat: 'dayFirst',
      dateSeparator: '.',
      amountFormat: { decimalSeparator: ',', groupingSeparator: '.' },
      dateRange: WHOLE_FILE_DATE_RANGE,
      directionAnswers: {},
      missingRequiredColumnLabels: [],
      currencies,
      accountById: new Map([[account.id, account]]),
      accountCreateCurrencies: {},
      accountCreateInstitutions: {},
      categoryById: new Map([[category.id, category]]),
      categoryCreateKinds: {},
      categoryTypesBySource: {},
      institutionById: new Map(),
      resolvedAccountMappings: { 'file-1': account.id },
      resolvedCategoryMappings: { Groceries: category.id },
      rowProblems: [],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].transaction.dt).toBe('2026-08-31')
    expect(rows[0].transaction.amount).toBe(-10099n)
  })

  it('caps preview rows to the first five mapped transactions', () => {
    const category = createCategory()
    const file = createFile(
      Array.from({ length: 6 }, (_, index) => ({
        Date: `2026-06-${String(index + 1).padStart(2, '0')}`,
        Amount: '1.00',
        Category: 'Groceries',
        Merchant: '',
        Notes: '',
        Tags: '',
        Currency: '',
      })),
    )

    const rows = buildImportPreviewRows({
      files: [file],
      columnMap: {
        ...EMPTY_COLUMN_MAP,
        dt: 'Date',
        amount: 'Amount',
        category_id: 'Category',
      },
      dateFormat: 'yearFirst',
      dateRange: WHOLE_FILE_DATE_RANGE,
      directionAnswers: {},
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
      rowProblems: [],
    })

    expect(rows).toHaveLength(5)
    expect(rows.at(-1)?.transaction.dt).toBe('2026-06-05')
    // The category lookup runs on every row, so the last row inside the cap has to carry one too
    expect(rows.at(-1)?.category).toMatchObject({ id: 'groceries', name: 'Groceries', kind: 'expense' })
  })

  // The preview used to fall back to the row's own sign, so a refund inside a source going both ways
  // previewed as income while the commit refused the whole import until a direction was chosen
  it('previews no category where the source has no settled direction yet', () => {
    const rows = buildImportPreviewRows({
      files: [
        createFile([
          {
            Date: '2026-06-01',
            Amount: '45.00',
            Category: 'Groceries',
            Merchant: '',
            Notes: '',
            Tags: '',
            Currency: '',
          },
        ]),
      ],
      columnMap: {
        ...EMPTY_COLUMN_MAP,
        dt: 'Date',
        amount: 'Amount',
        category_id: 'Category',
      },
      dateFormat: 'yearFirst',
      dateRange: WHOLE_FILE_DATE_RANGE,
      directionAnswers: {},
      missingRequiredColumnLabels: [],
      currencies,
      accountById: new Map([['checking', createAccount()]]),
      accountCreateCurrencies: {},
      accountCreateInstitutions: {},
      categoryById: new Map(),
      categoryCreateKinds: {},
      categoryTypesBySource: { Groceries: 'Mixed' },
      institutionById: new Map(),
      resolvedAccountMappings: { 'file-1': 'checking' },
      resolvedCategoryMappings: { Groceries: CREATE_CATEGORY_VALUE },
      rowProblems: [],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].category).toBeUndefined()
  })

  it('takes the kind from the direction read off the source, not the row', () => {
    const rows = buildImportPreviewRows({
      files: [
        createFile([
          {
            Date: '2026-06-01',
            Amount: '45.00',
            Category: 'Groceries',
            Merchant: '',
            Notes: '',
            Tags: '',
            Currency: '',
          },
        ]),
      ],
      columnMap: {
        ...EMPTY_COLUMN_MAP,
        dt: 'Date',
        amount: 'Amount',
        category_id: 'Category',
      },
      dateFormat: 'yearFirst',
      dateRange: WHOLE_FILE_DATE_RANGE,
      directionAnswers: {},
      missingRequiredColumnLabels: [],
      currencies,
      accountById: new Map([['checking', createAccount()]]),
      accountCreateCurrencies: {},
      accountCreateInstitutions: {},
      categoryById: new Map(),
      categoryCreateKinds: {},
      categoryTypesBySource: { Groceries: 'Expense' },
      institutionById: new Map(),
      resolvedAccountMappings: { 'file-1': 'checking' },
      resolvedCategoryMappings: { Groceries: CREATE_CATEGORY_VALUE },
      rowProblems: [],
    })

    expect(rows[0].category).toMatchObject({ name: 'Groceries', kind: 'expense' })
  })

  it('leaves out a row that is listed as one to fix, and takes the next one instead', () => {
    const category = createCategory()
    const file = createFile(
      Array.from({ length: 6 }, (_, index) => ({
        Date: `2026-06-${String(index + 1).padStart(2, '0')}`,
        Amount: '1.00',
        Category: 'Groceries',
        Merchant: '',
        Notes: '',
        Tags: '',
        Currency: '',
      })),
    )

    const rows = buildImportPreviewRows({
      files: [file],
      columnMap: {
        ...EMPTY_COLUMN_MAP,
        dt: 'Date',
        amount: 'Amount',
        category_id: 'Category',
      },
      dateFormat: 'yearFirst',
      dateRange: WHOLE_FILE_DATE_RANGE,
      directionAnswers: {},
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
      rowProblems: [
        {
          id: 'file-1-0',
          rowNumber: 1,
          cells: file.rows[0],
          reason: 'The amount is not a number.',
        },
      ],
    })

    // Still five, because the sample fills from what is left rather than leaving a gap where the
    // refused row was
    expect(rows).toHaveLength(5)
    expect(rows[0].transaction.dt).toBe('2026-06-02')
    expect(rows.at(-1)?.transaction.dt).toBe('2026-06-06')
  })
})

describe('previewing a new category renamed because another type holds its name', () => {
  it('shows the rows under the name typed for it', () => {
    const transferCar = createCategory({ id: 'transfer-car', name: 'Car', kind: 'transfer' })
    const account = createAccount()
    const rows = buildImportPreviewRows({
      files: [
        createFile([
          { Date: '2026-06-11', Amount: '-40.00', Category: 'Car', Merchant: '', Notes: '', Tags: '', Currency: '' },
        ]),
      ],
      columnMap: { ...EMPTY_COLUMN_MAP, dt: 'Date', amount: 'Amount', category_id: 'Category' },
      dateFormat: 'yearFirst',
      dateRange: WHOLE_FILE_DATE_RANGE,
      directionAnswers: {},
      missingRequiredColumnLabels: [],
      currencies,
      accountById: new Map([[account.id, account]]),
      accountCreateCurrencies: {},
      accountCreateInstitutions: {},
      categoryById: new Map([[transferCar.id, transferCar]]),
      categoryCreateKinds: { Car: 'expense' },
      categoryRenames: {
        Car: { name: 'Car costs', sourceName: 'Car', kind: 'expense', heldBy: transferCar, isProposed: false },
      },
      categoryTypesBySource: {},
      institutionById: new Map(),
      resolvedAccountMappings: { 'file-1': account.id },
      resolvedCategoryMappings: { Car: CREATE_CATEGORY_VALUE },
      rowProblems: [],
    })

    expect(rows[0].category).toMatchObject({ name: 'Car costs', kind: 'expense' })
  })
})

// The commit reuses a category the user already has under the same name, capitals folded, rather
// than writing a second one, so the preview shows that category instead of a new one
describe('previewing a new category whose name the user already has', () => {
  /**
   * Previews one expense row filed under `source`, answered create as an expense
   */
  function previewCreated(source: string, existing: Category, rename?: string) {
    const account = createAccount()
    return buildImportPreviewRows({
      files: [
        createFile([
          { Date: '2026-06-11', Amount: '-40.00', Category: source, Merchant: '', Notes: '', Tags: '', Currency: '' },
        ]),
      ],
      columnMap: { ...EMPTY_COLUMN_MAP, dt: 'Date', amount: 'Amount', category_id: 'Category' },
      dateFormat: 'yearFirst',
      dateRange: WHOLE_FILE_DATE_RANGE,
      directionAnswers: {},
      missingRequiredColumnLabels: [],
      currencies,
      accountById: new Map([[account.id, account]]),
      accountCreateCurrencies: {},
      accountCreateInstitutions: {},
      categoryById: new Map([[existing.id, existing]]),
      categoryCreateKinds: { [source]: 'expense' },
      categoryRenames:
        rename === undefined
          ? {}
          : { [source]: { name: rename, sourceName: source, kind: 'expense', heldBy: existing, isProposed: false } },
      categoryTypesBySource: {},
      institutionById: new Map(),
      resolvedAccountMappings: { 'file-1': account.id },
      resolvedCategoryMappings: { [source]: CREATE_CATEGORY_VALUE },
      rowProblems: [],
    })
  }

  it('shows the existing category of the same type, whatever its capitals', () => {
    const hobby = createCategory({ id: 'hobby', name: 'Hobby supplies', kind: 'expense', icon: '🧶' })

    expect(previewCreated('Hobby supplies', hobby)[0].category).toBe(hobby)
    expect(previewCreated('hobby supplies', hobby)[0].category).toBe(hobby)
  })

  it('keeps showing a new category where the existing one records another type', () => {
    const gifts = createCategory({ id: 'gifts', name: 'Gifts', kind: 'income' })

    const category = previewCreated('Presents', gifts, 'gifts')[0].category

    expect(category).toMatchObject({ name: 'gifts', kind: 'expense' })
    expect(category?.id).not.toBe(gifts.id)
  })
})

describe('previewing the tags the tag step answers', () => {
  const account = createAccount()

  /**
   * Previews one row carrying the tags in its cell, with the tag step answered as given
   */
  function previewTags(cell: string, tagAnswers: Parameters<typeof buildImportPreviewRows>[0]['tagAnswers']) {
    const [row] = buildImportPreviewRows({
      files: [
        createFile([
          { Date: '2026-06-11', Amount: '-40.00', Category: '', Merchant: '', Notes: '', Tags: cell, Currency: '' },
        ]),
      ],
      columnMap: { ...EMPTY_COLUMN_MAP, dt: 'Date', amount: 'Amount', tag_ids: 'Tags' },
      dateFormat: 'yearFirst',
      dateRange: WHOLE_FILE_DATE_RANGE,
      directionAnswers: {},
      missingRequiredColumnLabels: [],
      currencies,
      accountById: new Map([[account.id, account]]),
      accountCreateCurrencies: {},
      accountCreateInstitutions: {},
      categoryById: new Map(),
      categoryCreateKinds: {},
      categoryTypesBySource: { '': 'expense' },
      institutionById: new Map(),
      resolvedAccountMappings: { 'file-1': account.id },
      resolvedCategoryMappings: {},
      rowProblems: [],
      tagAnswers,
    })

    return row.transaction.tags.map((tag) => tag.name)
  }

  const answers = {
    importedTags: ['Junk', 'trvl'],
    matchedTagByKey: new Map(),
    tagMappings: {},
    tagCreateNames: {},
    tagLabelById: new Map(),
  }

  it('leaves a skipped name off the previewed row', () => {
    expect(previewTags('Junk, trvl', { ...answers, tagMappings: { Junk: SKIP_TAG_VALUE } })).toEqual(['trvl'])
  })

  it('shows a corrected name as the tag the row will carry', () => {
    expect(previewTags('Junk, trvl', { ...answers, tagCreateNames: { trvl: 'Travel' } })).toEqual(['Junk', 'Travel'])
  })

  it('shows the tag a name was pointed at', () => {
    const pointed = { ...answers, tagMappings: { trvl: 'food' }, tagLabelById: new Map([['food', 'Food']]) }

    expect(previewTags('Junk, trvl', pointed)).toEqual(['Junk', 'Food'])
  })
})

describe('previewing a chosen range of dates', () => {
  function previewDates(dateRange: { from: string; to: string }) {
    const account = createAccount()
    const rows = ['2026-01-15', '2026-03-15', '2026-05-15'].map((Date) => ({
      Date,
      Amount: '-40.00',
      Category: '',
      Merchant: '',
      Notes: '',
      Tags: '',
      Currency: '',
    }))
    return buildImportPreviewRows({
      files: [createFile(rows)],
      columnMap: { ...EMPTY_COLUMN_MAP, dt: 'Date', amount: 'Amount' },
      dateFormat: 'yearFirst',
      dateRange,
      directionAnswers: {},
      missingRequiredColumnLabels: [],
      currencies,
      accountById: new Map([[account.id, account]]),
      accountCreateCurrencies: {},
      accountCreateInstitutions: {},
      categoryById: new Map(),
      categoryCreateKinds: {},
      categoryRenames: {},
      categoryTypesBySource: {},
      institutionById: new Map(),
      resolvedAccountMappings: { 'file-1': account.id },
      resolvedCategoryMappings: {},
      rowProblems: [],
    }).map((row) => row.transaction.dt)
  }

  it('shows only the rows dated inside the range', () => {
    expect(previewDates({ from: '2026-03-01', to: '2026-03-31' })).toEqual(['2026-03-15'])
  })

  // Showing the whole file here would preview rows the import is about to leave out
  it('shows no rows while the ends are crossed', () => {
    expect(previewDates({ from: '2026-04-01', to: '2026-03-01' })).toEqual([])
  })
})
