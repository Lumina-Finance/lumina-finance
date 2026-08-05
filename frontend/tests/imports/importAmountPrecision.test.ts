/**
 * Tests that the import judges an amount against the decimal places its currency actually has, and
 * against the range the backend can store, so a value the commit would refuse is named against its
 * row beforehand rather than failing the request
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import {
  CREATE_ACCOUNT_VALUE,
  EMPTY_COLUMN_MAP,
  getRowAmountTooPreciseReason,
  getRowCurrencyMismatchReason,
  ROW_AMOUNT_TOO_LARGE_REASON,
  ROW_AMOUNT_UNREADABLE_REASON,
} from '@/pages/imports/constants'
import type { ColumnMap, ImportFileDraft } from '@/pages/imports/types'
import { buildImportPreviewRows, buildTransactionImportPayload, validateColumnValues } from '@/pages/imports/utils'
import { toImportMinorUnits } from '@/pages/imports/utils/valueParsers'

// PKR is here because the browser reports it as having no decimal places while the app's own table
// gives it two, which is the disagreement these tests pin down. BHD stands for the three-decimal
// currencies and JPY for the zero-decimal ones
const CURRENCIES: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'PKR', name: 'Pakistani Rupee', symbol: '₨', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese Yen', symbol: '¥', minor_unit_exponent: 0 },
  { id: 'BHD', name: 'Bahraini Dinar', symbol: 'BD', minor_unit_exponent: 3 },
]

const SUPPORTED_CURRENCY_CODES = new Set(CURRENCIES.map((currency) => currency.id))

// The largest and smallest amounts a two-decimal currency can hold, as the text a file would carry
const LARGEST_STORABLE = '92233720368547758.07'
const SMALLEST_STORABLE = '-92233720368547758.08'

const COLUMN_MAP: ColumnMap = {
  ...EMPTY_COLUMN_MAP,
  dt: 'Date',
  amount: 'Amount',
  category_id: 'Category',
  currency: 'Currency',
}

const GROCERIES: Category = {
  id: 'groceries',
  group_id: null,
  owner_id: null,
  name: 'Groceries',
  kind: 'expense',
  icon: null,
  is_system: false,
  created_at: '2026-01-01T00:00:00Z',
}

/**
 * Creates an account fixture holding the given currency
 */
function createAccount(currency: string): AccountsOverview {
  return {
    id: 'account-1',
    owner_id: null,
    group_id: null,
    account_kind: 'asset',
    account_type: 'checking',
    tax_advantaged_category_id: null,
    name: 'Everyday',
    institution: null,
    currency,
    current_balance: 0,
    base_currency_current_balance: 0,
    current_balance_fx_status: { state: 'complete', missing_pairs: [] },
    credit_limit: null,
    is_archived: false,
    closed_at: null,
  }
}

/**
 * Creates a one-file draft holding a single row with the given amount and currency cell
 */
function createFile(amount: string, importedCurrency = ''): ImportFileDraft {
  return {
    id: 'file-1',
    name: 'Everyday.csv',
    size: 512,
    headers: ['Date', 'Amount', 'Category', 'Currency'],
    hasHeaderRow: true,
    rows: [{ Date: '2026-04-11', Amount: amount, Category: 'Groceries', Currency: importedCurrency }],
    error: null,
  }
}

/**
 * Builds the commit payload for one row of the given amount, written to an account of the given
 * currency, with every other mapping already settled
 */
function buildPayload(amount: string, accountCurrency: string, importedCurrency = '') {
  return buildTransactionImportPayload({
    accountById: new Map([['account-1', createAccount(accountCurrency)]]),
    accountCreateCurrencies: {},
    accountCreateInstitutions: {},
    accountCreateTypes: {},
    accountMappings: { 'file-1': 'account-1' },
    accountSources: [{ id: 'file-1', label: 'Everyday.csv', matchText: 'Everyday.csv', isCounterpartyOnly: false }],
    categoryById: new Map([[GROCERIES.id, GROCERIES]]),
    categoryCreateKinds: {},
    categoryMappings: { Groceries: GROCERIES.id },
    categoryTypesBySource: {},
    columnMap: COLUMN_MAP,
    columnValidationErrors: {},
    currencies: CURRENCIES,
    dateFormat: 'yearFirst',
    files: [createFile(amount, importedCurrency)],
    importedCategories: ['Groceries'],
    noPayeeColumnConfirmed: true,
  })
}

/**
 * Builds the commit payload for one row whose account is queued for creation in the given currency,
 * which is where the row's decimal places come from when no account exists yet
 */
function buildCreateAccountPayload(amount: string, createCurrency: string, importedCurrency = '') {
  return buildTransactionImportPayload({
    accountById: new Map(),
    accountCreateCurrencies: { 'file-1': createCurrency },
    accountCreateInstitutions: {},
    accountCreateTypes: { 'file-1': 'checking' },
    accountMappings: { 'file-1': CREATE_ACCOUNT_VALUE },
    accountSources: [{ id: 'file-1', label: 'Everyday.csv', matchText: 'Everyday.csv', isCounterpartyOnly: false }],
    categoryById: new Map([[GROCERIES.id, GROCERIES]]),
    categoryCreateKinds: {},
    categoryMappings: { Groceries: GROCERIES.id },
    categoryTypesBySource: {},
    columnMap: COLUMN_MAP,
    columnValidationErrors: {},
    currencies: CURRENCIES,
    dateFormat: 'yearFirst',
    files: [createFile(amount, importedCurrency)],
    importedCategories: ['Groceries'],
    noPayeeColumnConfirmed: true,
  })
}

/**
 * Builds preview rows for one row of the given amount against an account of the given currency
 */
function buildPreview(amount: string, accountCurrency: string, importedCurrency = '') {
  return buildImportPreviewRows({
    files: [createFile(amount, importedCurrency)],
    columnMap: COLUMN_MAP,
    dateFormat: 'yearFirst',
    missingRequiredColumnLabels: [],
    currencies: CURRENCIES,
    accountById: new Map([['account-1', createAccount(accountCurrency)]]),
    accountCreateCurrencies: {},
    accountCreateInstitutions: {},
    categoryById: new Map([[GROCERIES.id, GROCERIES]]),
    categoryCreateKinds: {},
    categoryTypesBySource: {},
    institutionById: new Map(),
    resolvedAccountMappings: { 'file-1': 'account-1' },
    resolvedCategoryMappings: { Groceries: GROCERIES.id },
    rowProblems: [],
  })
}

/**
 * Reads the single row problem a build produced, or null when it produced none
 */
function firstProblem(build: ReturnType<typeof buildPayload>) {
  return build.rowProblems[0]?.reason ?? null
}

describe('converting an amount to minor units', () => {
  it('reads the digits the file states rather than what a double rounds to', () => {
    // 1.005 * 100 is 100.49999999999999 as a double, which used to round down to a whole 100 and
    // pass as valid, and the commit then refused the exact decimal
    expect(toImportMinorUnits('1.005', 2)).toBe('tooPrecise')
    expect(toImportMinorUnits('1.00', 2)).toBe(100n)
    expect(toImportMinorUnits('8.29', 2)).toBe(829n)
  })

  it('keeps trailing zeros droppable but refuses a digit the currency cannot hold', () => {
    expect(toImportMinorUnits('12.3400', 2)).toBe(1234n)
    expect(toImportMinorUnits('12.345', 2)).toBe('tooPrecise')
  })

  it('scales by the currency rather than by a hundred', () => {
    expect(toImportMinorUnits('1234', 0)).toBe(1234n)
    expect(toImportMinorUnits('12.34', 0)).toBe('tooPrecise')
    expect(toImportMinorUnits('1.234', 3)).toBe(1234n)
    expect(toImportMinorUnits('1.2345', 3)).toBe('tooPrecise')
  })

  it('reads a sign and comma grouping, and refuses anything else', () => {
    expect(toImportMinorUnits('-12.34', 2)).toBe(-1234n)
    expect(toImportMinorUnits('+12.34', 2)).toBe(1234n)
    expect(toImportMinorUnits('1,234.56', 2)).toBe(123456n)
    expect(toImportMinorUnits('$12.34', 2)).toBe('unreadable')
    expect(toImportMinorUnits('1.234.567', 2)).toBe('unreadable')
    expect(toImportMinorUnits('', 2)).toBe('unreadable')
  })

  it('holds both ends of the range the backend stores, and refuses one step past either', () => {
    expect(toImportMinorUnits(LARGEST_STORABLE, 2)).toBe(9223372036854775807n)
    expect(toImportMinorUnits(SMALLEST_STORABLE, 2)).toBe(-9223372036854775808n)
    expect(toImportMinorUnits('92233720368547758.08', 2)).toBe('tooLarge')
    expect(toImportMinorUnits('-92233720368547758.09', 2)).toBe('tooLarge')
  })
})

describe('refusing a row whose amount its currency cannot hold', () => {
  it('refuses an over-precise amount and blocks the commit rather than rounding it', () => {
    const build = buildPayload('1.005', 'CAD')

    expect(build.payload).toBeNull()
    expect(build.rowProblems).toHaveLength(1)
    expect(build.rowProblems[0].rowNumber).toBe(1)
    expect(firstProblem(build)).toBe(getRowAmountTooPreciseReason('CAD'))
  })

  it('says how a period is read, so a thousands separator is not called extra decimals', () => {
    const build = buildPayload('1.234', 'CAD')

    expect(firstProblem(build)).toContain('more decimal places than CAD has')
    expect(firstProblem(build)).toContain('never as a separator between thousands')
  })

  it('accepts the same value where the currency really has three decimal places', () => {
    const build = buildPayload('1.234', 'BHD')

    expect(build.rowProblems).toHaveLength(0)
    expect(build.payload?.rows[0].amount).toBe('1.234')
  })

  it('refuses a decimal part in a currency that has none', () => {
    expect(firstProblem(buildPayload('12.34', 'JPY'))).toBe(getRowAmountTooPreciseReason('JPY'))
    expect(buildPayload('1234', 'JPY').rowProblems).toHaveLength(0)
  })

  it('refuses an amount past what can be stored and accepts both ends of the range', () => {
    expect(firstProblem(buildPayload('92233720368547758.08', 'CAD'))).toBe(ROW_AMOUNT_TOO_LARGE_REASON)
    expect(firstProblem(buildPayload('-92233720368547758.09', 'CAD'))).toBe(ROW_AMOUNT_TOO_LARGE_REASON)
    expect(buildPayload(LARGEST_STORABLE, 'CAD').rowProblems).toHaveLength(0)
    expect(buildPayload(SMALLEST_STORABLE, 'CAD').rowProblems).toHaveLength(0)
  })

  it('still calls a cell that is not a number unreadable rather than over-precise', () => {
    expect(firstProblem(buildPayload('$12.34', 'CAD'))).toBe(ROW_AMOUNT_UNREADABLE_REASON)
  })

  it('judges the amount against the account currency, whatever the row states', () => {
    // The row is stored in its account's currency, so that is what decides its decimal places. The
    // currency the file states is a separate question, asked before this one
    expect(buildPayload('12.34', 'CAD', 'CAD').rowProblems).toHaveLength(0)
    expect(firstProblem(buildPayload('12.34', 'JPY'))).toBe(getRowAmountTooPreciseReason('JPY'))
    expect(firstProblem(buildPayload('12.34', 'JPY', 'JPY'))).toBe(getRowAmountTooPreciseReason('JPY'))
  })

  it('takes the currency chosen for an account queued for creation', () => {
    expect(firstProblem(buildCreateAccountPayload('12.34', 'JPY'))).toBe(getRowAmountTooPreciseReason('JPY'))
    expect(buildCreateAccountPayload('1234', 'JPY').rowProblems).toHaveLength(0)
  })
})

describe('validating a mapped currency column', () => {
  it('refuses a three-letter value that is no currency', () => {
    const result = validateColumnValues([createFile('12.34', 'ZZZ')], 'Currency', 'currency', SUPPORTED_CURRENCY_CODES)

    expect(result.valid).toBe(false)
    expect(result.message).toContain('"ZZZ"')
  })

  it('accepts a code the app supports, in either case', () => {
    expect(validateColumnValues([createFile('12.34', 'cad')], 'Currency', 'currency', SUPPORTED_CURRENCY_CODES).valid).toBe(true)
  })
})

describe('previewing an amount', () => {
  it('scales by the table\'s exponent for a currency the browser reports differently', () => {
    // A browser resolving PKR to zero fraction digits scaled 1234.56 down to 1235 minor units,
    // losing the decimals the file stated
    const rows = buildPreview('1234.56', 'PKR')

    expect(rows).toHaveLength(1)
    expect(rows[0].currency).toBe('PKR')
    expect(rows[0].transaction.amount).toBe(123456)
  })

  it('does not scale a zero-decimal currency by a hundred', () => {
    const rows = buildPreview('1234', 'JPY')

    expect(rows[0].currency).toBe('JPY')
    expect(rows[0].transaction.amount).toBe(1234)
  })

  // The commit refuses this row outright, so it only reaches the preview while the account step is
  // still unanswered. What it shows then is the account's currency rather than the file's
  it('takes its currency from the account rather than the row currency column', () => {
    const rows = buildPreview('12.34', 'CAD', 'JPY')

    expect(rows[0].currency).toBe('CAD')
    expect(rows[0].transaction.amount).toBe(1234)
  })

  it('leaves out a row whose amount the currency cannot hold instead of rounding it', () => {
    // The commit refuses this row, and previewing it would show $1.00 for a cell reading 1.005
    expect(buildPreview('1.005', 'CAD')).toHaveLength(0)
  })
})

describe('checking a row against the currency its account is kept in', () => {
  // The column was offered and then ignored, so a US statement imported into a Canadian account
  // stored every amount at face value and overstated the balance by the exchange rate
  it('refuses a row stating a currency the account is not kept in', () => {
    const result = buildPayload('12.34', 'CAD', 'USD')

    expect(result.payload).toBeNull()
    expect(result.rowProblems).toHaveLength(1)
    expect(result.rowProblems[0].rowNumber).toBe(1)
    expect(result.rowProblems[0].reason).toBe(getRowCurrencyMismatchReason('USD', 'CAD'))
  })

  it('imports a row stating the currency its account is kept in', () => {
    expect(buildPayload('12.34', 'CAD', 'CAD').payload?.rows).toHaveLength(1)
  })

  it('reads the stated currency whatever case the file wrote it in', () => {
    expect(buildPayload('12.34', 'CAD', 'cad').payload?.rows).toHaveLength(1)
    expect(buildPayload('12.34', 'CAD', 'usd').rowProblems).toHaveLength(1)
  })

  it('leaves a row alone where the currency cell is blank', () => {
    expect(buildPayload('12.34', 'CAD', '').payload?.rows).toHaveLength(1)
  })

  it('checks the currency chosen for an account queued for creation', () => {
    expect(buildCreateAccountPayload('1234', 'JPY', 'JPY').rowProblems).toHaveLength(0)
    expect(firstProblem(buildCreateAccountPayload('1234', 'JPY', 'CAD')))
      .toBe(getRowCurrencyMismatchReason('CAD', 'JPY'))
  })

  it('refuses the mismatch before judging the decimals', () => {
    // Both are wrong about this row, and the currency is the one worth acting on first
    expect(firstProblem(buildPayload('12.34', 'JPY', 'CAD'))).toBe(getRowCurrencyMismatchReason('CAD', 'JPY'))
  })
})
