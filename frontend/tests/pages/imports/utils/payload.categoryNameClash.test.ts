/**
 * Tests what the commit payload does with a value queued as a new category whose name the user
 * already has, which the commit reuses rather than writing a second category for, and with two new
 * categories whose names differ only in capitals, which the commit would write as one
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import { CREATE_CATEGORY_VALUE, EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import type { CsvRow, ImportCategoryKind, ImportCategoryRename, ImportFileDraft } from '@/pages/imports/types'
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
 * Creates a one-file import carrying a row filed under each of the given category values
 */
function createFile(categorySources: string[]): ImportFileDraft {
  const rows: CsvRow[] = categorySources.map((source) => ({ Date: '2026-04-11', Category: source, Amount: '-40.00' }))
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
  return buildCreatingCategories({ [categorySource]: kind }, categories)
}

/**
 * Builds a commit payload for each value answered "create new category" with the kind given for it
 */
function buildCreatingCategories(
  kinds: Record<string, ImportCategoryKind>,
  categories: Category[],
  categoryRenames: Record<string, ImportCategoryRename> = {},
) {
  const sources = Object.keys(kinds)
  return buildTransactionImportPayload({
    accountById: new Map(),
    accountCreateCurrencies: {},
    accountCreateInstitutions: {},
    accountCreateTypes: {},
    accountMappings: { 'file-1': 'account-1' },
    accountSources: [{ id: 'file-1', label: 'Chequing.csv', matchText: 'Chequing.csv', isCounterpartyOnly: false }],
    categoryById: new Map(categories.map((category) => [category.id, category])),
    categoryCreateKinds: kinds,
    categoryMappings: Object.fromEntries(sources.map((source) => [source, CREATE_CATEGORY_VALUE])),
    categoryRenames,
    categoryTypesBySource: {},
    columnMap: { ...EMPTY_COLUMN_MAP, dt: 'Date', category_id: 'Category', amount: 'Amount' },
    columnValidationErrors: {},
    currencies: CURRENCIES,
    dateFormat: 'yearFirst',
    directionAnswers: {},
    files: [createFile(sources)],
    importedCategories: sources,
  })
}

describe('queueing a new category under a name the user already has', () => {
  // The commit reuses the existing Bonus rather than writing a second one, and refuses because a
  // name records one direction. Caught here, the step can say which value to answer differently
  it.each([
    { existingKind: 'expense', requestedKind: 'income', wording: 'an expense category', typeLabel: 'Expense' },
    { existingKind: 'income', requestedKind: 'expense', wording: 'an income category', typeLabel: 'Income' },
    { existingKind: 'transfer', requestedKind: 'expense', wording: 'a transfer category', typeLabel: 'Transfer' },
  ] as const)('refuses one where the user has $wording, saying what to do instead', ({ existingKind, requestedKind, wording, typeLabel }) => {
    const { payload, errors } = build('Bonus', requestedKind, [{ ...PERSONAL_INCOME_BONUS, kind: existingKind }])

    expect(payload).toBeNull()
    expect(errors).toEqual([
      `Bonus is already ${wording}, so Bonus cannot be created with another type. Match it to Bonus, or set its type to ${typeLabel}.`,
    ])
  })

  it('refuses one spelled with different capitals just the same', () => {
    const { payload, errors } = build('BONUS', 'expense', [PERSONAL_INCOME_BONUS])

    expect(payload).toBeNull()
    expect(errors).toEqual([
      'Bonus is already an income category, so BONUS cannot be created with another type. Match it to Bonus, or set its type to Income.',
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

describe('queueing two new categories whose names differ only in capitals', () => {
  // The commit creates the first and reuses it for the second, which then lands in a category of
  // the other type and is refused. Caught here, as the other imports catch it
  it('refuses them when they are given different types, naming both', () => {
    const { payload, errors } = buildCreatingCategories({ Gifts: 'expense', GIFTS: 'income' }, [])

    expect(payload).toBeNull()
    expect(errors).toEqual(['Gifts and GIFTS would be created as one category, so they need the same type.'])
  })

  it('allows them when they are given the same type', () => {
    const { errors } = buildCreatingCategories({ Gifts: 'expense', GIFTS: 'expense' }, [])

    expect(errors).toEqual([])
  })
})

describe('renaming a new category whose name the user already has for another type', () => {
  const transferCar: Category = { ...PERSONAL_INCOME_BONUS, id: 'transfer-car', name: 'Car', kind: 'transfer' }
  const rename = (name: string): ImportCategoryRename => ({ name, sourceName: 'Car', kind: 'expense', heldBy: transferCar, isProposed: false })

  it('creates the category under the name typed for it', () => {
    const { payload, errors } = buildCreatingCategories({ Car: 'expense' }, [transferCar], { Car: rename(' Car costs ') })

    expect(errors).toEqual([])
    expect(payload?.categories).toEqual([{ source: 'Car', create: { name: 'Car costs', kind: 'expense', icon: '🏷️' } }])
  })

  it('asks for a name when the field is cleared', () => {
    const { payload, errors } = buildCreatingCategories({ Car: 'expense' }, [transferCar], { Car: rename('') })

    expect(payload).toBeNull()
    expect(errors).toEqual(['Enter a name for the new category from Car.'])
  })
})
