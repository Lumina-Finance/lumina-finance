/**
 * Tests Firefly III outcome prediction for skipped rows and non-blocking row guidance
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { FireflyImportRunResponse } from '@/api/firefly-imports'
import {
  CREATE_ACCOUNT_VALUE,
  CREATE_CATEGORY_VALUE,
  getRowNotesTooLongReason,
  getRowTooManyTagsReason,
  MAX_IMPORT_NOTES_LENGTH,
  MAX_IMPORT_TAGS_PER_ROW,
} from '@/pages/imports/constants'
import type { CsvRow, ImportRowProblem } from '@/pages/imports/types'
import {
  forecastFireflyImport,
  getFireflySkippedRowsDisplay,
  isFireflyRowUploadable,
  resolveFireflyRowLegs,
  type FireflySkippedRowDetail,
  type FireflyRowResolutionOptions,
} from '@/pages/imports/firefly/utils'
import {
  FIREFLY_GENERIC_SKIP_REASON,
  FIREFLY_MISSING_REQUIRED_VALUES_REASON,
  FIREFLY_SAMPLE_PREVIEW_LIMIT,
} from '@/pages/imports/firefly/constants'
import { createNameKeyedAccountSources } from './fixtures'

const EXPECTED_DEBT_PAYMENT_NOTE =
  'Make sure this payment is really an expense. Repayments of a credit card, line of credit or HELOC belong in Credit Card Payment. Debt Payment can remain selected for a loan or mortgage payment.'

const CURRENCIES: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'EUR', name: 'Euro', symbol: '€', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese Yen', symbol: '¥', minor_unit_exponent: 0 },
]

/**
 * Creates an account overview fixture for row resolution mapping
 */
function createAccount(overrides: Partial<AccountsOverview> = {}): AccountsOverview {
  return {
    id: 'checking',
    owner_id: null,
    group_id: null,
    account_kind: 'asset',
    account_type: 'checking',
    tax_advantaged_category_id: null,
    name: 'Chequing',
    institution: null,
    currency: 'CAD',
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
 * Creates a category fixture used by row resolution category mapping
 */
function createCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 'groceries',
    group_id: null,
    owner_id: null,
    name: 'Groceries',
    kind: 'expense',
    icon: null,
    is_system: false,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/**
 * Creates a journal row fixture shaped like the parsed transactions export
 */
function createFireflyRow(overrides: Partial<CsvRow> = {}): CsvRow {
  return {
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
    ...overrides,
  }
}

/**
 * Builds forecast options around one existing CAD chequing account mapping
 */
function createOptions(
  overrides: Partial<FireflyRowResolutionOptions> = {},
): FireflyRowResolutionOptions & { fileId: string } {
  const groceries = createCategory()
  return {
    accountSources: createNameKeyedAccountSources(),
    accountById: new Map([['checking', createAccount()]]),
    accountMappings: { Chequing: 'checking' },
    accountCreateDetails: {},
    institutionById: new Map(),
    categoryById: new Map([[groceries.id, groceries]]),
    categoryMappings: { Groceries: groceries.id },
    categoryCreateKinds: {},
    currencies: CURRENCIES,
    transferCategory: createCategory({ id: 'transfer', name: 'Transfer', kind: 'transfer', is_system: true }),
    balanceAdjustmentCategory: createCategory({
      id: 'balance-adjustment',
      name: 'Balance Adjustment',
      kind: 'transfer',
      is_system: true,
    }),
    ...overrides,
    fileId: 'transactions-file',
  }
}

/** Reads the warning collection as empty before the forecast exposes it */
function getForecastRowWarnings(forecast: ReturnType<typeof forecastFireflyImport>): ImportRowProblem[] {
  if (!('rowWarnings' in forecast)) return []
  return forecast.rowWarnings as ImportRowProblem[]
}

/** Creates one predicted skipped-row detail at a distinct source position */
function createSkippedDetail(
  index: number,
  overrides: Partial<FireflySkippedRowDetail> = {},
): FireflySkippedRowDetail {
  return {
    journalId: `journal-${index}`,
    rowNumber: index + 2,
    cells: { marker: `row-${index}` },
    reason: `Reason ${index}`,
    ...overrides,
  }
}

/** Creates a complete committed result with empty counters and mappings unless overridden */
function createImportResult(overrides: Partial<FireflyImportRunResponse> = {}): FireflyImportRunResponse {
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
    budgets_created: 0,
    budgets: [],
    accounts_archived: 0,
    archive_adjustments_created: 0,
    ...overrides,
  }
}

describe('getFireflySkippedRowsDisplay before commit', () => {
  it('shows the forecast rows under a future-tense title', () => {
    const forecastRows = [createSkippedDetail(0), createSkippedDetail(1)]

    expect(getFireflySkippedRowsDisplay({ liveForecastRows: forecastRows, completedImport: null })).toEqual({
      rows: forecastRows,
      totalCount: 2,
      title: '2 rows will not be imported',
    })
  })
})

describe('getFireflySkippedRowsDisplay after commit', () => {
  it('retains the commit-time source row after live account mappings move the same skip pair', () => {
    const sameAccountReason = 'Transfer source and destination resolve to the same account'
    const firstRow = createFireflyRow({
      journal_id: 'dup',
      type: 'Transfer',
      amount: '12.34',
      source_name: 'A',
      source_type: 'Asset account',
      destination_name: 'B',
      destination_type: 'Asset account',
      category: '',
    })
    const secondRow = createFireflyRow({
      journal_id: 'dup',
      type: 'Transfer',
      amount: '56.78',
      source_name: 'A',
      source_type: 'Asset account',
      destination_name: 'C',
      destination_type: 'Asset account',
      category: '',
    })
    const rows = [firstRow, secondRow]
    const accountById = new Map([
      ['account-1', createAccount({ id: 'account-1', name: 'Account 1' })],
      ['account-2', createAccount({ id: 'account-2', name: 'Account 2' })],
    ])
    const predictionAtCommit = forecastFireflyImport(
      rows,
      createOptions({
        accountById,
        accountMappings: { A: 'account-1', B: 'account-1', C: 'account-2' },
      }),
    )
    const livePrediction = forecastFireflyImport(
      rows,
      createOptions({
        accountById,
        accountMappings: { A: 'account-2', B: 'account-1', C: 'account-2' },
      }),
    )
    const importResult = createImportResult({ rows_imported: 1, transactions_created: 2 })

    expect(predictionAtCommit).toMatchObject({
      rowCount: 2,
      transactionEstimate: 2,
      skippedRows: [{ rowNumber: 2, cells: firstRow, reason: sameAccountReason }],
    })
    expect(livePrediction).toMatchObject({
      rowCount: 2,
      transactionEstimate: 2,
      skippedRows: [{ rowNumber: 3, cells: secondRow, reason: sameAccountReason }],
    })

    expect(getFireflySkippedRowsDisplay({
      liveForecastRows: livePrediction.skippedRows,
      completedImport: {
        result: importResult,
        skippedRowsAtCommit: predictionAtCommit.skippedRows,
      },
    })).toEqual({
      rows: [predictionAtCommit.skippedRows[0]],
      totalCount: 1,
      title: '1 row was not imported',
    })
  })

})

describe('forecastFireflyImport', () => {
  it('returns no rows when every row converts', () => {
    expect(forecastFireflyImport([createFireflyRow()], createOptions()).skippedRows).toEqual([])
  })

  it('falls back to the generic reason when resolution fails unexpectedly', () => {
    // A lookup that throws stands in for failure modes no skip rule anticipates
    const poisonedAccounts = {
      get: () => {
        throw new Error('unexpected resolution failure')
      },
    } as unknown as Map<string, AccountsOverview>

    const { skippedRows: skipped } = forecastFireflyImport(
      [createFireflyRow()],
      createOptions({ accountById: poisonedAccounts }),
    )

    expect(skipped.map((row) => row.reason)).toEqual([FIREFLY_GENERIC_SKIP_REASON])
  })

  // A well-shaped date naming no real day would pass the shape check but
  // fail the whole upload batch on the backend
  it('drops a row whose date names no real calendar day before upload', () => {
    const row = createFireflyRow({ date: '2024-02-31T00:00:00-05:00' })
    const { skippedRows: skipped } = forecastFireflyImport([row], createOptions())

    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toContain('date')
  })

  // Firefly III allows longer tags than a Lumina tag can hold, and one such
  // tag would fail the whole upload batch on the backend
  it('drops a row carrying a tag past the length cap before upload', () => {
    const row = createFireflyRow({ tags: `travel,${'x'.repeat(65)}` })
    const { skippedRows: skipped } = forecastFireflyImport([row], createOptions())

    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toBe(`Tag name is too long: ${'x'.repeat(28)}`)
  })

  // A Firefly import commits each batch as it goes, so a row the API refuses part-way through would
  // leave the batches before it in the ledger with no way to bring in the rest
  it('drops a row carrying more tags than a transaction holds, before upload', () => {
    const tags = Array.from({ length: MAX_IMPORT_TAGS_PER_ROW + 1 }, (_, index) => `tag${index}`).join(',')
    const { skippedRows: skipped } = forecastFireflyImport([createFireflyRow({ tags })], createOptions())

    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toBe(getRowTooManyTagsReason(MAX_IMPORT_TAGS_PER_ROW + 1))
  })

  it('drops a row whose notes are longer than the importer stores, before upload', () => {
    const notes = 'n'.repeat(MAX_IMPORT_NOTES_LENGTH + 1)
    const { skippedRows: skipped } = forecastFireflyImport([createFireflyRow({ notes })], createOptions())

    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toBe(getRowNotesTooLongReason(MAX_IMPORT_NOTES_LENGTH + 1))
  })

  it('keeps a row sitting exactly on both limits', () => {
    const tags = Array.from({ length: MAX_IMPORT_TAGS_PER_ROW }, (_, index) => `tag${index}`).join(',')
    const row = createFireflyRow({ tags, notes: 'n'.repeat(MAX_IMPORT_NOTES_LENGTH) })

    expect(forecastFireflyImport([row], createOptions()).skippedRows).toEqual([])
  })

  // Firefly III writes a liability's own balance increase as a Liability credit into the liability
  it('drops an unsupported journal type before upload, naming the raw type text', () => {
    const row = createFireflyRow({
      type: ' Liability credit ',
      source_name: 'Car Loan initial balance',
      source_type: 'Liability credit account',
      destination_name: 'Car Loan',
      destination_type: 'Loan',
    })
    const { skippedRows: skipped } = forecastFireflyImport([row], createOptions())

    expect(skipped).toEqual([{
      journalId: '1',
      rowNumber: 2,
      cells: row,
      reason: 'Journal type "Liability credit" is not supported, the importer handles withdrawals, deposits, transfers, opening balances, and reconciliations',
    }])
  })

  it('reports a missing amount in the account currency', () => {
    const { skippedRows: skipped } = forecastFireflyImport(
      [createFireflyRow({ currency_code: 'USD' })],
      createOptions(),
    )

    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toBe("Neither the amount nor the foreign amount is in the account's currency (CAD)")
    expect(skipped[0].cells?.currency_code).toBe('USD')
  })

  it('reports an unparseable amount with the raw value', () => {
    const { skippedRows: skipped } = forecastFireflyImport(
      [createFireflyRow({ amount: 'twelve' })],
      createOptions(),
    )

    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toBe('Invalid amount "twelve"')
  })

  // The upload carries both amounts, and the endpoint refuses malformed text wherever it sits
  it('drops a row whose unused foreign amount is malformed, since the upload still carries it', () => {
    const row = createFireflyRow({ foreign_amount: '-1,234.56', foreign_currency_code: 'USD' })
    const { skippedRows: skipped } = forecastFireflyImport([row], createOptions())

    expect(skipped.map((skippedRow) => skippedRow.reason)).toEqual(['Invalid amount "-1,234.56"'])
    expect(isFireflyRowUploadable(row, new Map())).toBe(false)
  })

  it('reports non-ASCII digits, grouping and invalid controls in the selected account amount', () => {
    for (const amount of ['-١2.34', '-12.34\u001C', '-1,234.56']) {
      const { skippedRows } = forecastFireflyImport(
        [
          createFireflyRow(),
          createFireflyRow({ journal_id: '2', amount }),
        ],
        createOptions(),
      )

      expect(skippedRows).toHaveLength(1)
      expect(skippedRows[0].journalId).toBe('2')
      expect(skippedRows[0].reason).toBe(`Invalid amount "${amount}"`)
    }
  })

  it.each(['-١2.34', '-1,234.56'])('reports invalid selected foreign amount %s', (amount) => {
    const row = createFireflyRow({
      amount: '-10.00',
      currency_code: 'USD',
      foreign_amount: amount,
      foreign_currency_code: 'CAD',
    })
    const { skippedRows } = forecastFireflyImport(
      [createFireflyRow(), { ...row, journal_id: '2' }],
      createOptions(),
    )

    expect(skippedRows).toHaveLength(1)
    expect(skippedRows[0].journalId).toBe('2')
    expect(skippedRows[0].reason).toBe(`Invalid amount "${amount}"`)
  })

  it('reports an amount carrying more decimal places than the account currency holds', () => {
    const { skippedRows: skipped } = forecastFireflyImport(
      [createFireflyRow({ amount: '-12.345' })],
      createOptions(),
    )

    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toBe(
      'The amount has more decimal places than CAD has. A period is read as a decimal point, never as a separator between thousands.',
    )
  })

  it('reports an amount past the storable range the way the backend does', () => {
    // Parser-range overflow keeps the raw invalid-amount reason, separate from excess precision
    const { skippedRows: skipped } = forecastFireflyImport(
      [createFireflyRow({ amount: '99999999999999999999.00' })],
      createOptions(),
    )

    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toBe('Invalid amount "99999999999999999999.00"')
  })

  it('reports the one amount that parses but cannot be stored once its sign is dropped', () => {
    // This import writes the magnitude, and the signed range holds one more value below zero than
    // above it, so this amount parses and its magnitude does not fit
    const { skippedRows: skipped } = forecastFireflyImport(
      [createFireflyRow({ amount: '-92233720368547758.08' })],
      createOptions(),
    )

    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toBe('Amount is too large: "-92233720368547758.08"')
  })

  // Mapping the old and new names of one account onto it is how a rename is
  // carried across, and a transfer between those names has nowhere to go
  it('reports a transfer whose two names map onto one account', () => {
    const { skippedRows: skipped } = forecastFireflyImport(
      [createFireflyRow({
        type: 'Transfer',
        amount: '-500.00',
        source_name: 'Chequing (old)',
        destination_name: 'Chequing',
        destination_type: 'Asset account',
        category: '',
      })],
      createOptions({ accountMappings: { Chequing: 'checking', 'Chequing (old)': 'checking' } }),
    )

    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toBe('Transfer source and destination resolve to the same account')
  })

  // Every account is new on a first import, and two accounts queued for creation share one
  // sentinel as their id, which must not read as one account
  it('keeps a transfer between two accounts queued for creation', () => {
    const createDetails = { accountType: 'checking', currency: 'CAD', institutionId: '' }
    const { skippedRows: skipped } = forecastFireflyImport(
      [createFireflyRow({
        type: 'Transfer',
        amount: '-500.00',
        source_name: 'Chequing',
        destination_name: 'Savings',
        destination_type: 'Asset account',
        category: '',
      })],
      createOptions({
        accountMappings: { Chequing: CREATE_ACCOUNT_VALUE, Savings: CREATE_ACCOUNT_VALUE },
        accountCreateDetails: { Chequing: createDetails, Savings: createDetails },
      }),
    )

    expect(skipped).toEqual([])
  })

  // A pair of imported accounts is a transfer whatever its known type, which a type the importer
  // does not know must not be guessed into
  it('drops an unsupported journal type between two imported accounts rather than writing a transfer', () => {
    const createDetails = { accountType: 'checking', currency: 'CAD', institutionId: '' }
    const row = createFireflyRow({
      type: 'Liability credit',
      source_name: 'Chequing',
      destination_name: 'Savings',
      destination_type: 'Asset account',
      category: '',
    })
    const options = createOptions({
      accountMappings: { Chequing: CREATE_ACCOUNT_VALUE, Savings: CREATE_ACCOUNT_VALUE },
      accountCreateDetails: { Chequing: createDetails, Savings: createDetails },
    })

    expect(forecastFireflyImport([row], options).skippedRows.map((skipped) => skipped.reason)).toEqual([
      'Journal type "Liability credit" is not supported, the importer handles withdrawals, deposits, transfers, opening balances, and reconciliations',
    ])
    expect(isFireflyRowUploadable(row, new Map())).toBe(false)
  })

  it('reports a withdrawal without an imported source account', () => {
    const { skippedRows: skipped } = forecastFireflyImport(
      [createFireflyRow({ source_name: 'Employer', source_type: 'Revenue account' })],
      createOptions(),
    )

    // Whether it imports never depends on a mapping, so it is dropped before upload
    expect(skipped).toEqual([expect.objectContaining({ reason: 'Withdrawal source is not an imported account' })])
  })

  it('neither skips nor counts a row whose account has no answer yet', () => {
    const forecast = forecastFireflyImport([createFireflyRow()], createOptions({ accountMappings: {} }))

    expect(forecast.skippedRows).toEqual([])
    expect(forecast.transactionEstimate).toBe(0)
  })

  it('reports a deposit without an imported destination account', () => {
    const { skippedRows: skipped } = forecastFireflyImport(
      [createFireflyRow({
        type: 'Deposit',
        source_name: 'Employer',
        source_type: 'Revenue account',
        destination_name: 'Market',
        destination_type: 'Expense account',
      })],
      createOptions(),
    )

    // Whether it imports never depends on a mapping, so it is dropped before upload
    expect(skipped).toEqual([expect.objectContaining({ reason: 'Deposit destination is not an imported account' })])
  })

  it('reports a transfer without two imported endpoints', () => {
    const { skippedRows: skipped } = forecastFireflyImport(
      [createFireflyRow({
        type: 'Transfer',
        destination_name: 'Untracked Wallet',
        destination_type: 'Expense account',
      })],
      createOptions(),
    )

    // Whether it imports never depends on a mapping, so it is dropped before upload
    expect(skipped).toEqual([expect.objectContaining({ reason: 'Transfer endpoint is not an imported account' })])
  })

  it('reports a balance row without an imported account side', () => {
    const { skippedRows: skipped } = forecastFireflyImport(
      [createFireflyRow({
        type: 'Opening balance',
        source_name: 'Wallet initial balance',
        source_type: 'Initial balance account',
        destination_name: 'Cash Wallet',
        destination_type: 'Expense account',
      })],
      createOptions(),
    )

    // Whether it imports never depends on a mapping, so it is dropped before upload
    expect(skipped).toEqual([expect.objectContaining({ reason: 'Opening balance or reconciliation row is not attached to an imported account' })])
  })

  it('reports rows the payload builder drops before upload', () => {
    const { skippedRows: skipped } = forecastFireflyImport(
      [createFireflyRow({ amount: ' ' })],
      createOptions(),
    )

    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toBe(`${FIREFLY_MISSING_REQUIRED_VALUES_REASON}: amount`)
  })

  it('keeps convertible rows out of the skip list in one pass', () => {
    const { skippedRows: skipped } = forecastFireflyImport(
      [
        createFireflyRow({ journal_id: '1' }),
        createFireflyRow({ journal_id: '2', currency_code: 'USD' }),
        createFireflyRow({ journal_id: '3' }),
      ],
      createOptions(),
    )

    expect(skipped.map((row) => row.journalId)).toEqual(['2'])
  })

  it('counts every parsed row so the row count minus the skips is what converts', () => {
    const forecast = forecastFireflyImport(
      [
        createFireflyRow({ journal_id: '1' }),
        createFireflyRow({ journal_id: '2', amount: '' }),
        createFireflyRow({ journal_id: '3', type: 'Liability credit' }),
      ],
      createOptions(),
    )

    expect(forecast.rowCount).toBe(3)
    expect(forecast.skippedRows).toHaveLength(2)
    expect(forecast.rowCount - forecast.skippedRows.length).toBe(1)
  })

  it('numbers skipped rows by their line in the uploaded file counting the header', () => {
    const { skippedRows: skipped } = forecastFireflyImport(
      [
        createFireflyRow({ journal_id: '1' }),
        createFireflyRow({ journal_id: '2', amount: 'twelve' }),
        createFireflyRow({ journal_id: '3', currency_code: 'USD' }),
      ],
      createOptions(),
    )

    expect(skipped.map((row) => row.rowNumber)).toEqual([3, 4])
  })

  it('warns for a withdrawal mapped directly to system Debt Payment', () => {
    const debtPayment = createCategory({
      id: 'debt-payment',
      name: 'Debt Payment',
      is_system: true,
    })
    const row = createFireflyRow()
    const forecast = forecastFireflyImport(
      [row],
      createOptions({
        categoryById: new Map([[debtPayment.id, debtPayment]]),
        categoryMappings: { Groceries: debtPayment.id },
      }),
    )

    expect(forecast).toMatchObject({
      rowCount: 1,
      transactionEstimate: 1,
      skippedRows: [],
      rowWarnings: [{
        id: 'transactions-file-0',
        rowNumber: 2,
        cells: row,
        reason: EXPECTED_DEBT_PAYMENT_NOTE,
      }],
    })
  })

  it.each([
    {
      label: 'the system category alone',
      categories: [createCategory({ id: 'debt-payment', name: 'Debt Payment', is_system: true })],
      warningCount: 1,
    },
    {
      label: 'a personal namesake beside the system category',
      categories: [
        createCategory({ id: 'debt-payment', name: 'Debt Payment', is_system: true }),
        createCategory({ id: 'personal-debt-payment', name: 'Debt Payment', owner_id: 'user-1' }),
      ],
      warningCount: 0,
    },
    {
      label: 'a group namesake beside the system category',
      categories: [
        createCategory({ id: 'group-debt-payment', name: 'Debt Payment', group_id: 'group-1' }),
        createCategory({ id: 'debt-payment', name: 'Debt Payment', is_system: true }),
      ],
      warningCount: 1,
    },
  ])('follows create-category reuse with $label', ({ categories, warningCount }) => {
    const row = createFireflyRow({ category: 'DEBT PAYMENT' })
    const options = createOptions({
      categoryById: new Map(categories.map((category) => [category.id, category])),
      categoryMappings: { 'DEBT PAYMENT': CREATE_CATEGORY_VALUE },
      categoryCreateKinds: { 'DEBT PAYMENT': 'expense' },
    })
    const forecast = forecastFireflyImport([row], options)

    expect(forecast).toMatchObject({ rowCount: 1, transactionEstimate: 1, skippedRows: [] })
    expect(options.categoryMappings).toEqual({ 'DEBT PAYMENT': CREATE_CATEGORY_VALUE })
    if (warningCount === 0) {
      expect(getForecastRowWarnings(forecast)).toEqual([])
    } else {
      expect(forecast).toMatchObject({
        rowWarnings: [{
          id: 'transactions-file-0',
          rowNumber: 2,
          cells: row,
          reason: EXPECTED_DEBT_PAYMENT_NOTE,
        }],
      })
    }
  })

  it.each([
    { type: 'Withdrawal', mapping: 'direct' },
    { type: 'Withdrawal', mapping: 'create reuse' },
    { type: 'Deposit', mapping: 'direct' },
    { type: 'Deposit', mapping: 'create reuse' },
  ])('does not warn when a $type with $mapping resolves between two imported accounts', ({ type, mapping }) => {
    const debtPayment = createCategory({
      id: 'debt-payment',
      name: 'Debt Payment',
      is_system: true,
    })
    const savings = createAccount({ id: 'savings', name: 'Savings' })
    const categorySource = mapping === 'direct' ? 'Groceries' : 'DEBT PAYMENT'
    const row = createFireflyRow({
      type,
      destination_name: 'Savings',
      destination_type: 'Asset account',
      category: categorySource,
    })
    const forecast = forecastFireflyImport(
      [row],
      createOptions({
        accountById: new Map([
          ['checking', createAccount()],
          ['savings', savings],
        ]),
        accountMappings: { Chequing: 'checking', Savings: 'savings' },
        categoryById: new Map([[debtPayment.id, debtPayment]]),
        categoryMappings: {
          [categorySource]: mapping === 'direct' ? debtPayment.id : CREATE_CATEGORY_VALUE,
        },
        categoryCreateKinds: mapping === 'direct' ? {} : { [categorySource]: 'expense' },
      }),
    )

    expect(forecast).toMatchObject({ rowCount: 1, transactionEstimate: 2, skippedRows: [] })
    expect(getForecastRowWarnings(forecast)).toEqual([])
  })

  it.each([
    {
      type: 'Opening balance',
      source_name: 'Chequing initial balance',
      source_type: 'Initial balance account',
      destination_name: 'Chequing',
      destination_type: 'Asset account',
    },
    {
      type: 'Reconciliation',
      source_name: 'Chequing',
      source_type: 'Asset account',
      destination_name: 'Chequing reconciliation',
      destination_type: 'Reconciliation account',
    },
  ])('does not warn when $type resolves to Balance Adjustment', (rowShape) => {
    const debtPayment = createCategory({
      id: 'debt-payment',
      name: 'Debt Payment',
      is_system: true,
    })
    const forecast = forecastFireflyImport(
      [createFireflyRow({ ...rowShape, category: 'Groceries' })],
      createOptions({
        categoryById: new Map([[debtPayment.id, debtPayment]]),
        categoryMappings: { Groceries: debtPayment.id },
      }),
    )

    expect(forecast).toMatchObject({ rowCount: 1, transactionEstimate: 1, skippedRows: [] })
    expect(getForecastRowWarnings(forecast)).toEqual([])
  })

  it('does not warn for a skipped row mapped to system Debt Payment', () => {
    const debtPayment = createCategory({
      id: 'debt-payment',
      name: 'Debt Payment',
      is_system: true,
    })
    const forecast = forecastFireflyImport(
      [createFireflyRow({ type: 'Liability credit' })],
      createOptions({
        categoryById: new Map([[debtPayment.id, debtPayment]]),
        categoryMappings: { Groceries: debtPayment.id },
      }),
    )

    expect(forecast.skippedRows.map((row) => row.reason)).toEqual([
      'Journal type "Liability credit" is not supported, the importer handles withdrawals, deposits, transfers, opening balances, and reconciliations',
    ])
    expect(getForecastRowWarnings(forecast)).toEqual([])
  })

  it('warns for every qualifying row after the preview sample without colliding on journal ID', () => {
    const groceries = createCategory()
    const debtPayment = createCategory({
      id: 'debt-payment',
      name: 'Debt Payment',
      is_system: true,
    })
    const rows = Array.from({ length: FIREFLY_SAMPLE_PREVIEW_LIMIT + 2 }, (_, index) => createFireflyRow({
      journal_id: index >= FIREFLY_SAMPLE_PREVIEW_LIMIT ? 'shared-journal' : String(index + 1),
      date: `2026-06-${String(index + 1).padStart(2, '0')} 00:00:00`,
      category: index >= FIREFLY_SAMPLE_PREVIEW_LIMIT ? 'Debt Payment' : 'Groceries',
    }))
    const forecast = forecastFireflyImport(
      rows,
      createOptions({
        categoryById: new Map([
          [groceries.id, groceries],
          [debtPayment.id, debtPayment],
        ]),
        categoryMappings: {
          Groceries: groceries.id,
          'Debt Payment': debtPayment.id,
        },
      }),
    )

    expect(forecast).toMatchObject({
      rowCount: FIREFLY_SAMPLE_PREVIEW_LIMIT + 2,
      transactionEstimate: FIREFLY_SAMPLE_PREVIEW_LIMIT + 2,
      skippedRows: [],
      rowWarnings: [
        {
          id: `transactions-file-${FIREFLY_SAMPLE_PREVIEW_LIMIT}`,
          rowNumber: FIREFLY_SAMPLE_PREVIEW_LIMIT + 2,
          cells: rows[FIREFLY_SAMPLE_PREVIEW_LIMIT],
          reason: EXPECTED_DEBT_PAYMENT_NOTE,
        },
        {
          id: `transactions-file-${FIREFLY_SAMPLE_PREVIEW_LIMIT + 1}`,
          rowNumber: FIREFLY_SAMPLE_PREVIEW_LIMIT + 3,
          cells: rows[FIREFLY_SAMPLE_PREVIEW_LIMIT + 1],
          reason: EXPECTED_DEBT_PAYMENT_NOTE,
        },
      ],
    })
  })
})

describe('Firefly rows past what the import endpoint takes', () => {
  // Each field at its limit and one past it, since the endpoint refuses the whole batch for a
  // longer value
  const cases: [string, string, number, (length: number) => Partial<CsvRow>][] = [
    ['journal id', 'journal id', 64, (length) => ({ journal_id: '1'.repeat(length) })],
    ['amount', 'amount', 64, (length) => ({ amount: `-${'1'.repeat(length - 4)}.00` })],
    ['foreign amount', 'foreign amount', 64, (length) => ({ foreign_amount: `-${'1'.repeat(length - 4)}.00`, foreign_currency_code: 'USD' })],

    // The endpoint counts code points, so an emoji is one character to it, not two
    ['description', 'description', 1024, (length) => ({ description: '🛒'.repeat(length) })],
    ['category', 'category', 256, (length) => ({ category: 'c'.repeat(length) })],
    ['withdrawal payee', 'payee name', 256, (length) => ({ destination_name: 'p'.repeat(length) })],
    ['deposit payee', 'payee name', 256, (length) => ({
      type: 'Deposit',
      amount: '2500.00',
      source_name: 'p'.repeat(length),
      source_type: 'Revenue account',
      destination_name: 'Chequing',
      destination_type: 'Asset account',
    })],
  ]

  // These rows may be left out for other reasons as well, which the length check is not about
  const pastLimit = (rows: FireflySkippedRowDetail[]) => rows.filter((row) => row.reason.includes('and the importer takes up to'))

  it.each(cases)('drops a row whose %s is past its limit and uploads one at the limit', (_, field, maxLength, build) => {
    const atLimit = createFireflyRow(build(maxLength))
    const overLimitRow = createFireflyRow({ journal_id: '2', ...build(maxLength + 1) })

    const { skippedRows: skipped } = forecastFireflyImport([atLimit, overLimitRow], createOptions())

    expect(isFireflyRowUploadable(atLimit, new Map())).toBe(true)
    expect(pastLimit(skipped)).toEqual([expect.objectContaining({
      journalId: overLimitRow.journal_id,
      reason: `The ${field} is ${(maxLength + 1).toLocaleString()} characters, and the importer takes up to ${maxLength.toLocaleString()}.`,
    })])
  })

  // Only a payee row is sent with its category, so a transfer's long category costs nothing
  it('uploads a transfer whose category is past the limit', () => {
    const transfer = createFireflyRow({
      type: 'Transfer',
      category: 'c'.repeat(257),
      destination_name: 'Savings',
      destination_type: 'Asset account',
    })

    expect(pastLimit(forecastFireflyImport([transfer], createOptions()).skippedRows)).toEqual([])
  })

  it('names a blank type among the missing values', () => {
    const { skippedRows: skipped } = forecastFireflyImport([createFireflyRow({ type: '  ' })], createOptions())

    expect(skipped).toEqual([expect.objectContaining({
      reason: 'Missing required values: type',
    })])
  })

  // Firefly III takes custom currency codes such as USDT, which no Lumina account is kept in, and
  // the amount in one is left out of the upload, however long it is
  it.each([
    ['in a code Lumina cannot hold', { amount: `-${'1'.repeat(70)}.00`, currency_code: 'USDT' }],
    ['without a currency', { currency_code: '' }],
  ])('imports the foreign amount when the main one is %s', (_, main) => {
    const row = createFireflyRow({ ...main, foreign_amount: '-16.80', foreign_currency_code: 'CAD' })

    const { skippedRows: skipped } = forecastFireflyImport([row], createOptions())

    expect(skipped).toEqual([])
    expect(resolveFireflyRowLegs(row, createOptions()).legs?.map((leg) => leg.amount)).toEqual([-1680])
  })

  it('names the currency as missing when neither amount is in a three-letter code', () => {
    const row = createFireflyRow({ currency_code: 'USDT', foreign_amount: '-1.00', foreign_currency_code: 'XBTC' })

    const { skippedRows: skipped } = forecastFireflyImport([row], createOptions())

    expect(skipped).toEqual([expect.objectContaining({ reason: 'Missing required values: currency' })])
  })
})
