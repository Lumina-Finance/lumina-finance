/**
 * Tests Firefly III outcome prediction for skipped rows and non-blocking row guidance
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { FireflyTransactionImportResponse } from '@/api/firefly-imports'
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
  type FireflySkippedRowDetail,
  type FireflyRowResolutionOptions,
} from '@/pages/imports/firefly/utils'
import {
  FIREFLY_GENERIC_SKIP_REASON,
  FIREFLY_MISSING_REQUIRED_VALUES_REASON,
  FIREFLY_SAMPLE_PREVIEW_LIMIT,
} from '@/pages/imports/firefly/constants'

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
    closed_at: null,
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
    droppedBeforeUpload: false,
    ...overrides,
  }
}

/** Creates a complete committed result with empty counters and mappings unless overridden */
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

/** Shapes one returned server reason without claiming source metadata */
function createServerDisplayDetail(journalId: string, reason: string): FireflySkippedRowDetail {
  return {
    journalId,
    rowNumber: null,
    cells: null,
    reason,
    droppedBeforeUpload: false,
  }
}

describe('getFireflySkippedRowsDisplay before commit', () => {
  it('keeps the forecast rows, count and future-tense title without mutating its input', () => {
    const forecastRows = [
      createSkippedDetail(0),
      createSkippedDetail(1, { droppedBeforeUpload: true }),
    ]
    const originalRows = forecastRows.map((row) => ({
      ...row,
      cells: row.cells ? { ...row.cells } : null,
    }))

    const display = getFireflySkippedRowsDisplay({
      liveForecastRows: forecastRows,
      completedImport: null,
    })

    expect(display).toEqual({
      rows: forecastRows,
      totalCount: 2,
      title: '2 rows will not be imported',
    })
    expect(forecastRows).toEqual(originalRows)
  })
})

describe('getFireflySkippedRowsDisplay after commit', () => {
  it('combines disjoint skips, enriches one unique match and leaves a server-only row blank', () => {
    const uploaded = createSkippedDetail(1, {
      journalId: 'uploaded',
      rowNumber: 3,
      cells: { marker: 'uploaded-row' },
      reason: 'Predicted and returned',
    })
    const browserDropped = createSkippedDetail(3, {
      journalId: 'browser-dropped',
      rowNumber: 5,
      cells: { marker: 'browser-row' },
      reason: 'Dropped by the browser',
      droppedBeforeUpload: true,
    })
    const forecastRows = [uploaded, browserDropped]
    const importResult = createImportResult({
      rows_skipped: 2,
      skipped: [
        { journal_id: uploaded.journalId, reason: uploaded.reason },
        { journal_id: 'server-only', reason: 'Only the server saw this row.' },
      ],
    })
    const originalForecastRows = forecastRows.map((row) => ({
      ...row,
      cells: row.cells ? { ...row.cells } : null,
    }))
    const originalServerRows = importResult.skipped.map((row) => ({ ...row }))

    const display = getFireflySkippedRowsDisplay({
      liveForecastRows: forecastRows,
      completedImport: { result: importResult, predictedSkippedRowsAtCommit: forecastRows },
    })

    expect(display).toEqual({
      rows: [
        uploaded,
        browserDropped,
        createServerDisplayDetail('server-only', 'Only the server saw this row.'),
      ],
      totalCount: 3,
      title: '3 rows were not imported',
    })
    expect(forecastRows).toEqual(originalForecastRows)
    expect(importResult.skipped).toEqual(originalServerRows)
  })

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
    const importResult = createImportResult({
      rows_imported: 1,
      transactions_created: 2,
      rows_skipped: 1,
      skipped: [{ journal_id: 'dup', reason: sameAccountReason }],
    })

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
        predictedSkippedRowsAtCommit: predictionAtCommit.skippedRows,
      },
    })).toEqual({
      rows: [predictionAtCommit.skippedRows[0]],
      totalCount: 1,
      title: '1 row was not imported',
    })
  })

  it('drops an uploaded forecast row omitted by the authoritative result', () => {
    const forecastRows = [createSkippedDetail(0)]

    expect(getFireflySkippedRowsDisplay({
      liveForecastRows: forecastRows,
      completedImport: {
        result: createImportResult(),
        predictedSkippedRowsAtCommit: forecastRows,
      },
    })).toEqual({
      rows: [],
      totalCount: 0,
      title: '0 rows were not imported',
    })
  })

  it('keeps a browser-dropped pair separate and never lends its metadata to the server row', () => {
    const browserDropped = createSkippedDetail(0, {
      journalId: 'same-pair',
      reason: 'Same reason',
      droppedBeforeUpload: true,
    })
    const importResult = createImportResult({
      rows_skipped: 1,
      skipped: [{ journal_id: browserDropped.journalId, reason: browserDropped.reason }],
    })
    const forecastRows = [browserDropped]

    expect(getFireflySkippedRowsDisplay({
      liveForecastRows: forecastRows,
      completedImport: { result: importResult, predictedSkippedRowsAtCommit: forecastRows },
    })).toEqual({
      rows: [
        browserDropped,
        createServerDisplayDetail(browserDropped.journalId, browserDropped.reason),
      ],
      totalCount: 2,
      title: '2 rows were not imported',
    })
  })

  it('matches repeated journal IDs by their distinct reasons and restores source order', () => {
    const first = createSkippedDetail(0, {
      journalId: 'repeated-journal',
      cells: { marker: 'first-row' },
      reason: 'First reason',
    })
    const second = createSkippedDetail(1, {
      journalId: 'repeated-journal',
      cells: { marker: 'second-row' },
      reason: 'Second reason',
    })
    const importResult = createImportResult({
      rows_skipped: 2,
      skipped: [
        { journal_id: second.journalId, reason: second.reason },
        { journal_id: first.journalId, reason: first.reason },
      ],
    })
    const forecastRows = [first, second]

    expect(getFireflySkippedRowsDisplay({
      liveForecastRows: forecastRows,
      completedImport: { result: importResult, predictedSkippedRowsAtCommit: forecastRows },
    })).toEqual({
      rows: [first, second],
      totalCount: 2,
      title: '2 rows were not imported',
    })
  })

  it('retains repeated returned pairs without assigning either forecast occurrence', () => {
    const first = createSkippedDetail(0, {
      journalId: 'same-pair',
      cells: { marker: 'first-row' },
      reason: 'Same reason',
    })
    const second = createSkippedDetail(1, {
      journalId: 'same-pair',
      cells: { marker: 'second-row' },
      reason: 'Same reason',
    })
    const importResult = createImportResult({
      rows_skipped: 2,
      skipped: [
        { journal_id: 'same-pair', reason: 'Same reason' },
        { journal_id: 'same-pair', reason: 'Same reason' },
      ],
    })
    const forecastRows = [first, second]

    expect(getFireflySkippedRowsDisplay({
      liveForecastRows: forecastRows,
      completedImport: { result: importResult, predictedSkippedRowsAtCommit: forecastRows },
    })).toEqual({
      rows: [
        createServerDisplayDetail('same-pair', 'Same reason'),
        createServerDisplayDetail('same-pair', 'Same reason'),
      ],
      totalCount: 2,
      title: '2 rows were not imported',
    })
  })

  it('keeps every sampled repeated pair blank when one batch omitted an indistinguishable row', () => {
    const forecastRows = Array.from({ length: 52 }, (_, index) => createSkippedDetail(index, {
      journalId: 'same-pair',
      cells: { marker: `raw-row-${index}` },
      reason: 'Same reason',
    }))
    const returnedRows = Array.from(
      { length: 51 },
      () => ({ journal_id: 'same-pair', reason: 'Same reason' }),
    )
    const importResult = createImportResult({ rows_skipped: 52, skipped: returnedRows })

    const display = getFireflySkippedRowsDisplay({
      liveForecastRows: forecastRows,
      completedImport: { result: importResult, predictedSkippedRowsAtCommit: forecastRows },
    })

    expect(display.totalCount).toBe(52)
    expect(display.rows).toHaveLength(51)
    expect(display.title).toBe('52 rows were not imported')
    expect(display.rows.every((row) => row.rowNumber === null && row.cells === null)).toBe(true)
    expect(display.rows).not.toContainEqual(expect.objectContaining({ cells: { marker: 'raw-row-50' } }))
    expect(display.rows).toEqual(returnedRows.map((row) => (
      createServerDisplayDetail(row.journal_id, row.reason)
    )))
  })

  it('keeps the exact total separate from the available detail sample and display cap', () => {
    const browserDropped = createSkippedDetail(0, { droppedBeforeUpload: true })
    const returnedRows = Array.from({ length: 50 }, (_, index) => ({
      journal_id: `server-${index}`,
      reason: `Server reason ${index}`,
    }))
    const importResult = createImportResult({ rows_skipped: 73, skipped: returnedRows })
    const forecastRows = [browserDropped]

    const display = getFireflySkippedRowsDisplay({
      liveForecastRows: forecastRows,
      completedImport: { result: importResult, predictedSkippedRowsAtCommit: forecastRows },
    })

    expect(display.totalCount).toBe(74)
    expect(display.rows).toHaveLength(51)
    expect(display.rows[0]).toEqual(browserDropped)
    expect(display.rows.slice(1)).toEqual(returnedRows.map((row) => (
      createServerDisplayDetail(row.journal_id, row.reason)
    )))
    expect(display.title).toBe('74 rows were not imported')
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
    expect(skipped[0].droppedBeforeUpload).toBe(true)
  })

  // Firefly III allows longer tags than a Lumina tag can hold, and one such
  // tag would fail the whole upload batch on the backend
  it('drops a row carrying a tag past the length cap before upload', () => {
    const row = createFireflyRow({ tags: `travel,${'x'.repeat(65)}` })
    const { skippedRows: skipped } = forecastFireflyImport([row], createOptions())

    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toBe(`Tag name is too long: ${'x'.repeat(28)}`)
    expect(skipped[0].droppedBeforeUpload).toBe(true)
  })

  // A Firefly import commits each batch as it goes, so a row the API refuses part-way through would
  // leave the batches before it in the ledger with no way to bring in the rest
  it('drops a row carrying more tags than a transaction holds, before upload', () => {
    const tags = Array.from({ length: MAX_IMPORT_TAGS_PER_ROW + 1 }, (_, index) => `tag${index}`).join(',')
    const { skippedRows: skipped } = forecastFireflyImport([createFireflyRow({ tags })], createOptions())

    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toBe(getRowTooManyTagsReason(MAX_IMPORT_TAGS_PER_ROW + 1))
    expect(skipped[0].droppedBeforeUpload).toBe(true)
  })

  it('drops a row whose notes are longer than the importer stores, before upload', () => {
    const notes = 'n'.repeat(MAX_IMPORT_NOTES_LENGTH + 1)
    const { skippedRows: skipped } = forecastFireflyImport([createFireflyRow({ notes })], createOptions())

    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toBe(getRowNotesTooLongReason(MAX_IMPORT_NOTES_LENGTH + 1))
    expect(skipped[0].droppedBeforeUpload).toBe(true)
  })

  it('keeps a row sitting exactly on both limits', () => {
    const tags = Array.from({ length: MAX_IMPORT_TAGS_PER_ROW }, (_, index) => `tag${index}`).join(',')
    const row = createFireflyRow({ tags, notes: 'n'.repeat(MAX_IMPORT_NOTES_LENGTH) })

    expect(forecastFireflyImport([row], createOptions()).skippedRows).toEqual([])
  })

  it('reports an unsupported journal type with the raw type text', () => {
    const row = createFireflyRow({ type: ' Liability credit ' })
    const { skippedRows: skipped } = forecastFireflyImport([row], createOptions())

    expect(skipped).toEqual([{
      journalId: '1',
      rowNumber: 2,
      cells: row,
      reason: 'Journal type "Liability credit" is not supported, the importer handles withdrawals, deposits, transfers, opening balances, and reconciliations',
      droppedBeforeUpload: false,
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

  it('reports a withdrawal without an imported source account', () => {
    const { skippedRows: skipped } = forecastFireflyImport(
      [createFireflyRow({ source_name: 'Employer', source_type: 'Revenue account' })],
      createOptions(),
    )

    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toBe('Withdrawal source is not an imported account')
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

    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toBe('Deposit destination is not an imported account')
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

    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toBe('Transfer endpoint is not an imported account')
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

    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toBe('Opening balance or reconciliation row is not attached to an imported account')
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

  it('marks only the rows dropped before upload so results can add them back', () => {
    const { skippedRows: skipped } = forecastFireflyImport(
      [
        createFireflyRow({ journal_id: '1', amount: '' }),
        createFireflyRow({ journal_id: '2', type: 'Liability credit' }),
      ],
      createOptions(),
    )

    expect(skipped.map((row) => [row.journalId, row.droppedBeforeUpload])).toEqual([
      ['1', true],
      ['2', false],
    ])
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
