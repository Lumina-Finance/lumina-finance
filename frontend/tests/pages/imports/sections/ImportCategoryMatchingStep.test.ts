/**
 * Tests the CSV import's Category matching step, so a category answered "Create new" whose name the
 * user already has for the same type shows as that category without a New badge, since the import
 * reuses it rather than creating one, while a new category and one whose name another type holds
 * still show as new
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import { CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
import { ImportCategoryMatchingStep } from '@/pages/imports/sections'
import type { ImportCategoryKind } from '@/pages/imports/types'
import { buildImportCategoryMatchOptions, getCsvCategoryRenames } from '@/pages/imports/utils'

/**
 * Creates one of the user's own categories
 */
function createCategory(id: string, name: string, kind: Category['kind']): Category {
  return { id, group_id: null, owner_id: 'user-1', name, kind, icon: null, is_system: false, created_at: '2026-01-01T00:00:00Z' }
}

const HOBBY_SUPPLIES = createCategory('hobby', 'Hobby supplies', 'expense')
const GIFTS = createCategory('gifts', 'Gifts', 'income')

/**
 * Renders the step with every value answered "Create new" as an expense, and returns the markup of
 * each value's row, keyed by the value
 *
 * @param categoriesBeforeImport - The categories the user had before a finished import, which by
 *   default are all of them, as before any import
 * @param kinds - Types chosen over the default expense, whose clashes get the other name the
 *   workflow proposes, while the defaults are left without one
 */
function renderRows(categoriesBeforeImport = [HOBBY_SUPPLIES, GIFTS], kinds: Record<string, ImportCategoryKind> = {}) {
  const importedCategories = ['hobby supplies', 'Gardening', 'Gifts']
  const categoryById = new Map([HOBBY_SUPPLIES, GIFTS].map((category) => [category.id, category]))
  const categoryMappings = Object.fromEntries(importedCategories.map((source) => [source, CREATE_CATEGORY_VALUE]))
  const categoryCreateKinds = { ...Object.fromEntries(importedCategories.map((source) => [source, 'expense' as const])), ...kinds }
  const markup = renderToStaticMarkup(createElement(ImportCategoryMatchingStep, {
    importedCategories,
    categoryMappings,
    autoFilledCategories: new Set<string>(),
    categoryCreateKinds,
    categoryTypesBySource: {},
    // Gifts is left without another name, so only its type tells it apart from the income category it shares one with
    categoryRenames: getCsvCategoryRenames({
      importedCategories: Object.keys(kinds),
      mappings: categoryMappings,
      createKinds: categoryCreateKinds,
      typesBySource: {},
      typedNames: {},
      categoryById,
    }),
    categoryById,
    categoriesBeforeImport: new Map(categoriesBeforeImport.map((category) => [category.id, category])),
    setCategoryCreateKinds: () => undefined,
    setCategoryCreateNames: () => undefined,
    setCategoryMappings: () => undefined,
    categoryMatchOptions: buildImportCategoryMatchOptions([HOBBY_SUPPLIES, GIFTS]),
    categoriesLoading: false,
    categoriesFailed: false,
    refetchCategories: () => undefined,
    clearedCategorySourceLabels: [],
    importResult: null,
  }))

  const rows = markup.split('<tr').slice(2)
  return Object.fromEntries(importedCategories.map((source) => [source, rows.find((row) => row.includes(`>${source}<`)) ?? '']))
}

describe('the CSV import\'s Category matching step', () => {
  it('marks only the categories the import will create as new', () => {
    const rows = renderRows()

    expect(rows['hobby supplies']).not.toBe('')
    expect(rows['hobby supplies']).not.toContain('>New<')
    expect(rows.Gardening).toContain('>New<')
    expect(rows.Gifts).toContain('>New<')
  })

  it('shows a category the import reuses as that category in its dropdown', () => {
    const rows = renderRows()

    expect(rows['hobby supplies']).toContain('>Hobby supplies<')
    expect(rows['hobby supplies']).not.toContain('Create new category')
    expect(rows.Gardening).toContain('Create new category')
    expect(rows.Gifts).toContain('Create new category')
  })

  it('shows a reused category as new again once its type is switched away from the one it has', () => {
    const rows = renderRows(undefined, { 'hobby supplies': 'income' })

    expect(rows['hobby supplies']).toContain('Create new category')
    expect(rows['hobby supplies']).toContain('>New<')
    expect(rows['hobby supplies']).toContain('value="hobby supplies (CSV)"')
  })

  it('keeps showing a category a finished import created as new on its record', () => {
    const rows = renderRows([GIFTS])

    expect(rows['hobby supplies']).toContain('Create new category')
    expect(rows['hobby supplies']).toContain('>New<')
  })
})
