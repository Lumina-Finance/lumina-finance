/**
 * Tests what the commit payload does with a value queued as a new category whose name the user
 * already has, which the commit reuses rather than writing a second category for
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import { CREATE_CATEGORY_VALUE, EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import type { CsvRow, ImportCategoryKind, ImportFileDraft } from '@/pages/imports/types'
import { buildTransactionImportPayload } from '@/pages/imports/utils'

const CURRENCIES: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
]

const PERSONAL_INCOME_BONUS: Category = {
  id: 'personal-income-bonus',
  group_id: null,
  owner_id: 'user-1',
  name: 'Bonus',
  kind: 'income',
  icon: null,
  is_system: false,
  created_at: '2026-01-01T00:00:00Z',
}

const GROUP_EXPENSE_TRAVEL: Category = {
  ...PERSONAL_INCOME_BONUS,
  id: 'group-expense-travel',
  owner_id: null,
  group_id: 'group-1',
  name: 'Travel',
  kind: 'expense',
}

const HEADERS = ['Date', 'Category', 'Amount']

/**
 * Creates a one-file import carrying a single row filed under the given category value
 */
function createFile(categorySource: string): ImportFileDraft {
  const rows: CsvRow[] = [{ Date: '2026-04-11', Category: categorySource, Amount: '-40.00' }]
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

/**
 * Builds a commit payload for one value answered "create new category" with the kind given
 */
function build(categorySource: string, kind: ImportCategoryKind, categories: Category[]) {
  return buildTransactionImportPayload({
    accountById: new Map(),
    accountCreateCurrencies: {},
    accountCreateInstitutions: {},
    accountCreateTypes: {},
    accountMappings: { 'file-1': 'account-1' },
    accountSources: [{ id: 'file-1', label: 'Chequing.csv', matchText: 'Chequing.csv', isCounterpartyOnly: false }],
    categoryById: new Map(categories.map((category) => [category.id, category])),
    categoryCreateKinds: { [categorySource]: kind },
    categoryMappings: { [categorySource]: CREATE_CATEGORY_VALUE },
    categoryTypesBySource: {},
    columnMap: { ...EMPTY_COLUMN_MAP, dt: 'Date', category_id: 'Category', amount: 'Amount' },
    columnValidationErrors: {},
    currencies: CURRENCIES,
    dateFormat: 'yearFirst',
    directionAnswers: {},
    files: [createFile(categorySource)],
    importedCategories: [categorySource],
  })
}

describe('queueing a new category under a name the user already has', () => {
  it('refuses one recording the other direction, saying what to do instead', () => {
    // The commit reuses the income Bonus rather than writing an expense one, and refuses because a
    // name records one direction. Caught here, the step can say which value to answer differently
    const { payload, errors } = build('Bonus', 'expense', [PERSONAL_INCOME_BONUS])

    expect(payload).toBeNull()
    expect(errors).toEqual([
      'Bonus already records income, so Bonus cannot be created. Match it to that category, or set its type to income.',
    ])
  })

  it('refuses one spelled with different capitals just the same', () => {
    const { payload, errors } = build('BONUS', 'expense', [PERSONAL_INCOME_BONUS])

    expect(payload).toBeNull()
    expect(errors).toEqual([
      'Bonus already records income, so BONUS cannot be created. Match it to that category, or set its type to income.',
    ])
  })

  it('allows one recording the same direction, which the commit reuses', () => {
    const { payload, errors } = build('BONUS', 'income', [PERSONAL_INCOME_BONUS])

    expect(errors).toEqual([])
    expect(payload?.categories).toEqual([{
      source: 'BONUS',
      create: { name: 'BONUS', kind: 'income', icon: '🏷️' },
    }])
  })

  it('allows one whose name only a group holds, which the commit does not reuse', () => {
    const { payload, errors } = build('Travel', 'income', [GROUP_EXPENSE_TRAVEL])

    expect(errors).toEqual([])
    expect(payload?.categories).toEqual([{
      source: 'Travel',
      create: { name: 'Travel', kind: 'income', icon: '🏷️' },
    }])
  })
})
