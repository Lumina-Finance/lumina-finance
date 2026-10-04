/**
 * Tests the name an import proposes for a new category whose own name an existing category
 * holds for another kind, which would otherwise block the import
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import { CREATE_CATEGORY_VALUE, EMPTY_COLUMN_MAP, getImportCategoryRenameHelp } from '@/pages/imports/constants'
import type { ImportCategoryKind } from '@/pages/imports/types'
import { getCsvCategoryRenames, getImportCategoryRenames, getImportedCategoryTypes } from '@/pages/imports/utils'

const CREDIT_CARD_PAYMENT = {
  id: 'credit-card-payment',
  group_id: null,
  owner_id: null,
  name: 'Credit Card Payment',
  kind: 'transfer',
  icon: null,
  is_system: true,
  created_at: '2026-01-01T00:00:00Z',
} as Category

const SOURCES = [{ id: 'actual-ccp', name: 'Credit Card Payment' }]

function getRenames(overrides: Partial<Parameters<typeof getImportCategoryRenames>[0]> = {}) {
  return getImportCategoryRenames({
    sources: SOURCES,
    mappings: { 'actual-ccp': CREATE_CATEGORY_VALUE },
    kinds: { 'actual-ccp': 'expense' },
    typedNames: {},
    categoryById: new Map([[CREDIT_CARD_PAYMENT.id, CREDIT_CARD_PAYMENT]]),
    appName: 'Actual',
    ...overrides,
  })
}

describe('renaming a new category whose name another kind holds', () => {
  it('proposes the name marked with the app and says which category holds it', () => {
    expect(getRenames()).toEqual({
      'actual-ccp': { name: 'Credit Card Payment (Actual)', sourceName: 'Credit Card Payment', kind: 'expense', heldBy: CREDIT_CARD_PAYMENT, isProposed: true },
    })
  })

  // A cleared field stays cleared, so the import asks for a name rather than quietly restoring one
  it('keeps the name the user typed, even a blank one', () => {
    expect(getRenames({ typedNames: { 'actual-ccp': 'Card payoff' } })['actual-ccp']).toMatchObject({ name: 'Card payoff', isProposed: false })
    expect(getRenames({ typedNames: { 'actual-ccp': '' } })['actual-ccp']).toMatchObject({ name: '', isProposed: false })
  })

  it('leaves the name alone where nothing blocks it', () => {
    expect(getRenames({ kinds: { 'actual-ccp': 'transfer' } })).toEqual({})
    expect(getRenames({ mappings: { 'actual-ccp': CREDIT_CARD_PAYMENT.id } })).toEqual({})
  })
})

const TRANSFER_CAR = { ...CREDIT_CARD_PAYMENT, id: 'car', name: 'Car', is_system: false, owner_id: 'user-1' } as Category
const INCOME_BONUS = { ...TRANSFER_CAR, id: 'bonus', name: 'Bonus', kind: 'income' } as Category

/**
 * Settles the CSV renames for a file whose rows carry the given category and amount, with any names
 * the user typed
 */
function getCsvRenames(
  rows: Array<{ Category: string; Amount: string }>,
  createKinds: Record<string, ImportCategoryKind> = {},
  typedNames: Record<string, string> = {},
) {
  const files = [{ id: 'file-1', name: 'Chequing.csv', size: 1, headers: ['Category', 'Amount'], hasHeaderRow: true, rows, error: null }]
  const columnMap = { ...EMPTY_COLUMN_MAP, category_id: 'Category', amount: 'Amount' }
  const importedCategories = [...new Set(rows.map((row) => row.Category))]
  return getCsvCategoryRenames({
    importedCategories,
    mappings: Object.fromEntries(importedCategories.map((category) => [category, CREATE_CATEGORY_VALUE])),
    createKinds,
    typesBySource: getImportedCategoryTypes(files, columnMap, importedCategories, {}),
    typedNames,
    categoryById: new Map([TRANSFER_CAR, INCOME_BONUS].map((category) => [category.id, category])),
  })
}

describe('renaming a new category from a CSV file whose name another type holds', () => {
  it('proposes the name marked as from the CSV for rows whose amounts read as expenses, saying a transfer category holds it', () => {
    const renames = getCsvRenames([{ Category: 'Car', Amount: '-40.00' }, { Category: 'Car', Amount: '-12.50' }])

    expect(renames.Car).toMatchObject({ name: 'Car (CSV)', kind: 'expense', heldBy: TRANSFER_CAR, isProposed: true })
    expect(getImportCategoryRenameHelp(renames.Car)).toBe(
      '"Car" is already a transfer category. If you\'d still like to import transactions categorized as "Car" as an expense category, you have to rename it.',
    )
  })

  it('takes the name the user typed in place of the proposal, so the field no longer reads as needing one', () => {
    const renames = getCsvRenames([{ Category: 'Car', Amount: '-40.00' }], {}, { Car: 'Car costs' })

    expect(renames.Car).toMatchObject({ name: 'Car costs', isProposed: false })
  })

  it('says an income category holds the name for rows typed as expenses', () => {
    const renames = getCsvRenames([{ Category: 'Bonus', Amount: '500.00' }], { Bonus: 'expense' })

    expect(getImportCategoryRenameHelp(renames.Bonus)).toBe(
      '"Bonus" is already an income category. If you\'d still like to import transactions categorized as "Bonus" as an expense category, you have to rename it.',
    )
  })

  // Amounts moving both ways leave the type open, so there is no type yet that the name could clash with
  it('offers no new name while the rows leave the type open', () => {
    expect(getCsvRenames([{ Category: 'Car', Amount: '-40.00' }, { Category: 'Car', Amount: '40.00' }])).toEqual({})
  })
})
