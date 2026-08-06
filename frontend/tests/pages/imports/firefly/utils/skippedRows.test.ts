/**
 * Tests Firefly III skipped-row prediction so the preview step lists unconvertible rows with the reasons the backend reports
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import {
  CREATE_ACCOUNT_VALUE,
  getRowNotesTooLongReason,
  getRowTooManyTagsReason,
  MAX_IMPORT_NOTES_LENGTH,
  MAX_IMPORT_TAGS_PER_ROW,
} from '@/pages/imports/constants'
import type { CsvRow } from '@/pages/imports/types'
import {
  forecastFireflyImport,
  type FireflyRowResolutionOptions,
} from '@/pages/imports/firefly/utils'
import {
  FIREFLY_GENERIC_SKIP_REASON,
  FIREFLY_MISSING_REQUIRED_VALUES_REASON,
} from '@/pages/imports/firefly/constants'

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
 * Builds resolution options around one existing CAD chequing account mapping
 */
function createOptions(overrides: Partial<FireflyRowResolutionOptions> = {}): FireflyRowResolutionOptions {
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
  }
}

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

  it('reports an amount carrying more decimal places than the account currency holds', () => {
    const { skippedRows: skipped } = forecastFireflyImport(
      [createFireflyRow({ amount: '-12.345' })],
      createOptions(),
    )

    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toBe('Invalid amount "-12.345"')
  })

  it('reports an amount past the storable range the way the backend does', () => {
    // The backend catches its parser's malformed, over-precise and out-of-range errors in one
    // clause and reports all three as an invalid amount, so a different wording here would name
    // the same skipped row two ways between the preview and the result
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
})
