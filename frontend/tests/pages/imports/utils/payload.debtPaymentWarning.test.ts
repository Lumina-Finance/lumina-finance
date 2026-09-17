/**
 * Tests non-blocking guidance for CSV rows that will use the system Debt Payment category
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import {
  CREATE_CATEGORY_VALUE,
  EMPTY_COLUMN_MAP,
  getRowSignDisagreesWithCategoryReason,
  ROW_AMOUNT_UNREADABLE_REASON,
} from '@/pages/imports/constants'
import type { CsvRow, ImportCategoryKind, ImportFileDraft } from '@/pages/imports/types'
import { buildTransactionImportPayload } from '@/pages/imports/utils'

const EXPECTED_DEBT_PAYMENT_NOTE =
  'Make sure this payment is really an expense. Repayments of a credit card, line of credit or HELOC belong in Credit Card Payment. Debt Payment can remain selected for a loan or mortgage payment.'

const CURRENCIES: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
]

const SYSTEM_DEBT_PAYMENT: Category = {
  id: 'system-debt-payment',
  group_id: null,
  owner_id: null,
  name: 'Debt Payment',
  kind: 'expense',
  icon: null,
  is_system: true,
  created_at: '2026-01-01T00:00:00Z',
}

const PERSONAL_DEBT_PAYMENT: Category = {
  ...SYSTEM_DEBT_PAYMENT,
  id: 'personal-debt-payment',
  owner_id: 'user-1',
  is_system: false,
}

const GROUP_DEBT_PAYMENT: Category = {
  ...SYSTEM_DEBT_PAYMENT,
  id: 'group-debt-payment',
  group_id: 'group-1',
  is_system: false,
}

const CREDIT_CARD_PAYMENT: Category = {
  ...SYSTEM_DEBT_PAYMENT,
  id: 'credit-card-payment',
  name: 'Credit Card Payment',
  kind: 'transfer',
}

const SYSTEM_GROCERIES: Category = {
  ...SYSTEM_DEBT_PAYMENT,
  id: 'system-groceries',
  name: 'Groceries',
}

const HEADERS = ['Date', 'Category', 'Amount']

/** Creates one staged CSV with the supplied rows */
function createFile(rows: CsvRow[]): ImportFileDraft {
  return {
    id: 'file-1',
    name: 'Chequing.csv',
    size: 512,
    headers: HEADERS,
    hasHeaderRow: true,
    rows,
    error: null,
  }
}

/** Creates a valid row filed under the supplied source and amount */
function createRow(amount: string, categorySource = 'Debt Payment', index = 0): CsvRow {
  return {
    Date: `2026-04-${String(index + 1).padStart(2, '0')}`,
    Category: categorySource,
    Amount: amount,
  }
}

/** Builds a real generic import payload around one category answer */
function build({
  rows = [createRow('-125.00')],
  categories = [SYSTEM_DEBT_PAYMENT],
  categorySource = 'Debt Payment',
  categoryChoice = SYSTEM_DEBT_PAYMENT.id,
  createKind,
}: {
  rows?: CsvRow[]
  categories?: Category[]
  categorySource?: string
  categoryChoice?: string
  createKind?: ImportCategoryKind
} = {}) {
  return buildTransactionImportPayload({
    accountById: new Map(),
    accountCreateCurrencies: {},
    accountCreateInstitutions: {},
    accountCreateTypes: {},
    accountMappings: { 'file-1': 'account-1' },
    accountSources: [{ id: 'file-1', label: 'Chequing.csv', matchText: 'Chequing.csv', isCounterpartyOnly: false }],
    categoryById: new Map(categories.map((category) => [category.id, category])),
    categoryCreateKinds: createKind ? { [categorySource]: createKind } : {},
    categoryMappings: { [categorySource]: categoryChoice },
    categoryTypesBySource: {},
    columnMap: { ...EMPTY_COLUMN_MAP, dt: 'Date', category_id: 'Category', amount: 'Amount' },
    columnValidationErrors: {},
    currencies: CURRENCIES,
    dateFormat: 'yearFirst',
    directionAnswers: {},
    files: [createFile(rows)],
    importedCategories: [categorySource],
  })
}

describe('guidance for CSV rows filed under system Debt Payment', () => {
  it('keeps every amount and combines the positive-row notes without duplicating its identity', () => {
    const rows = [
      createRow('-125.00', 'Debt Payment', 0),
      createRow('125.00', 'Debt Payment', 1),
      createRow('0.00', 'Debt Payment', 2),
    ]
    const result = build({ rows })

    expect(result.payload?.categories).toEqual([{
      source: 'Debt Payment',
      category_id: SYSTEM_DEBT_PAYMENT.id,
    }])
    expect(result.payload?.rows.map((row) => row.amount)).toEqual(['-125.00', '125.00', '0.00'])
    expect(result.rowWarnings).toEqual([
      { id: 'file-1-0', rowNumber: 1, cells: rows[0], reason: EXPECTED_DEBT_PAYMENT_NOTE },
      {
        id: 'file-1-1',
        rowNumber: 2,
        cells: rows[1],
        reason: `${getRowSignDisagreesWithCategoryReason('expense')} ${EXPECTED_DEBT_PAYMENT_NOTE}`,
      },
      { id: 'file-1-2', rowNumber: 3, cells: rows[2], reason: EXPECTED_DEBT_PAYMENT_NOTE },
    ])
  })

  it('warns when a create answer reuses system Debt Payment without changing the create payload', () => {
    const result = build({
      rows: [createRow('-125.00', 'DEBT PAYMENT')],
      categorySource: 'DEBT PAYMENT',
      categoryChoice: CREATE_CATEGORY_VALUE,
      createKind: 'expense',
    })

    expect(result.payload?.categories).toEqual([{
      source: 'DEBT PAYMENT',
      create: { name: 'DEBT PAYMENT', kind: 'expense', icon: '🏷️' },
    }])
    expect(result.rowWarnings.map((warning) => warning.reason)).toEqual([EXPECTED_DEBT_PAYMENT_NOTE])
  })

  it('lets a personal namesake take precedence over the system category', () => {
    const result = build({
      rows: [createRow('-125.00', 'DEBT PAYMENT')],
      categories: [SYSTEM_DEBT_PAYMENT, PERSONAL_DEBT_PAYMENT],
      categorySource: 'DEBT PAYMENT',
      categoryChoice: CREATE_CATEGORY_VALUE,
      createKind: 'expense',
    })

    expect(result.payload?.categories).toEqual([{
      source: 'DEBT PAYMENT',
      create: { name: 'DEBT PAYMENT', kind: 'expense', icon: '🏷️' },
    }])
    expect(result.rowWarnings).toEqual([])
  })

  it('excludes a group namesake and still recognizes the reusable system category', () => {
    const result = build({
      rows: [createRow('-125.00', 'DEBT PAYMENT')],
      categories: [GROUP_DEBT_PAYMENT, SYSTEM_DEBT_PAYMENT],
      categorySource: 'DEBT PAYMENT',
      categoryChoice: CREATE_CATEGORY_VALUE,
      createKind: 'expense',
    })

    expect(result.payload?.categories).toEqual([{
      source: 'DEBT PAYMENT',
      create: { name: 'DEBT PAYMENT', kind: 'expense', icon: '🏷️' },
    }])
    expect(result.rowWarnings.map((warning) => warning.reason)).toEqual([EXPECTED_DEBT_PAYMENT_NOTE])
  })

  it.each([
    { label: 'personal Debt Payment', category: PERSONAL_DEBT_PAYMENT },
    { label: 'group Debt Payment', category: GROUP_DEBT_PAYMENT },
    { label: 'Credit Card Payment', category: CREDIT_CARD_PAYMENT },
    { label: 'another system expense', category: SYSTEM_GROCERIES },
  ])('does not warn for $label', ({ category }) => {
    const result = build({ categories: [category], categoryChoice: category.id })

    expect(result.payload?.categories).toEqual([{
      source: 'Debt Payment',
      category_id: category.id,
    }])
    expect(result.rowWarnings).toEqual([])
  })

  it('does not warn before the category source is mapped', () => {
    const result = build({ categoryChoice: '' })

    expect(result.errors).toEqual(['Map category: Debt Payment'])
    expect(result.payload).toBeNull()
    expect(result.rowWarnings).toEqual([])
  })

  it('does not warn for a row whose amount cannot be imported', () => {
    const row = createRow('twelve')
    const result = build({ rows: [row] })

    expect(result.errors).toEqual([])
    expect(result.payload).toBeNull()
    expect(result.rowProblems).toEqual([{
      id: 'file-1-0',
      rowNumber: 1,
      cells: row,
      reason: ROW_AMOUNT_UNREADABLE_REASON,
    }])
    expect(result.rowWarnings).toEqual([])
  })

  it('does not warn when a create answer clashes with the reusable category kind', () => {
    const result = build({
      rows: [createRow('-125.00', 'DEBT PAYMENT')],
      categorySource: 'DEBT PAYMENT',
      categoryChoice: CREATE_CATEGORY_VALUE,
      createKind: 'income',
    })

    expect(result.errors).toEqual([
      'Debt Payment already records expense, so DEBT PAYMENT cannot be created. Match it to that category, or set its type to expense.',
    ])
    expect(result.payload).toBeNull()
    expect(result.rowWarnings).toEqual([])
  })
})
