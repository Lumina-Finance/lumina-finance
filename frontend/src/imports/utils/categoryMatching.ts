import type { Category } from '@/api/categories'
import { CREATE_CATEGORY_VALUE } from '../constants'
import type { ImportCategoryKind, ImportFileDraft } from '../types'
import { parseImportNumber } from './valueParsers'

export function splitImportedValues(value: string) {
  return value
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function getImportedCategoryTypes(
  files: ImportFileDraft[],
  categoryHeader: string,
  amountHeader: string,
  importedCategories: string[],
) {
  const signsByCategory = new Map<string, Set<'expense' | 'income'>>()

  if (!categoryHeader || !amountHeader) {
    return Object.fromEntries(importedCategories.map((category) => [category, '']))
  }

  for (const file of files) {
    if (!file.headers.includes(categoryHeader) || !file.headers.includes(amountHeader)) continue

    for (const row of file.rows) {
      const category = row[categoryHeader]?.trim()
      if (!category) continue

      const amount = parseImportNumber(row[amountHeader] ?? '')
      if (amount === null || amount === 0) continue

      const signs = signsByCategory.get(category) ?? new Set<'expense' | 'income'>()
      signs.add(amount < 0 ? 'expense' : 'income')
      signsByCategory.set(category, signs)
    }
  }

  return Object.fromEntries(importedCategories.map((category) => {
    const signs = signsByCategory.get(category)
    if (!signs || signs.size === 0) return [category, '']
    if (signs.size > 1) return [category, 'Mixed']
    return [category, signs.has('expense') ? 'Expense' : 'Income']
  }))
}

export function keepCurrentMatchMap(
  current: Record<string, string>,
  sources: string[],
) {
  let changed = Object.keys(current).length !== sources.length
  const next: Record<string, string> = {}

  for (const source of sources) {
    next[source] = current[source] ?? ''
    if (current[source] !== next[source]) changed = true
  }

  return changed ? next : current
}

export function getCategoryMatchKind(
  selectedCategoryId: string,
  createKind: ImportCategoryKind | undefined,
  inferredType: string | undefined,
  categoryById: Map<string, Category>,
) {
  if (isExistingCategoryMatch(selectedCategoryId)) {
    return categoryById.get(selectedCategoryId)?.kind ?? ''
  }

  return createKind ?? getCategoryKindFromTypeLabel(inferredType)
}

export function isExistingCategoryMatch(value: string) {
  return Boolean(value && value !== CREATE_CATEGORY_VALUE)
}

function getCategoryKindFromTypeLabel(categoryType: string | undefined): ImportCategoryKind | '' {
  if (categoryType === 'Transfer') return 'transfer'
  if (categoryType === 'Income') return 'income'
  if (categoryType === 'Expense') return 'expense'
  return ''
}

