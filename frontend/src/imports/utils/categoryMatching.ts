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

export function inferCategoryMappings(
  importedCategories: string[],
  current: Record<string, string>,
  categories: Category[],
  categoryTypesBySource: Record<string, string>,
) {
  const next = { ...keepCurrentMatchMap(current, importedCategories) }

  for (const source of importedCategories) {
    if (next[source]) continue

    const match = findBestCategoryNameMatch(
      source,
      categories,
      getCategoryKindFromTypeLabel(categoryTypesBySource[source]),
    )
    if (match) next[source] = match.id
  }

  return next
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

function findBestCategoryNameMatch(
  source: string,
  categories: Category[],
  expectedKind: ImportCategoryKind | '',
) {
  let bestMatch: { category: Category; score: number } | null = null
  let tied = false

  for (const category of categories) {
    if (expectedKind && category.kind !== expectedKind) continue

    const score = scoreCategoryNameMatch(source, category.name)
    if (score <= 0) continue

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { category, score }
      tied = false
      continue
    }

    if (score === bestMatch.score) tied = true
  }

  return bestMatch && !tied ? bestMatch.category : null
}

function scoreCategoryNameMatch(source: string, categoryName: string) {
  const normalizedSource = normalizeCategoryName(source)
  const normalizedCategory = normalizeCategoryName(categoryName)
  if (!normalizedSource || !normalizedCategory) return 0

  const compactSource = normalizedSource.replace(/\s/g, '')
  const compactCategory = normalizedCategory.replace(/\s/g, '')
  if (normalizedSource === normalizedCategory || compactSource === compactCategory) return 100

  const shorterLength = Math.min(normalizedSource.length, normalizedCategory.length)
  if (shorterLength >= 4 && (normalizedSource.includes(normalizedCategory) || normalizedCategory.includes(normalizedSource))) {
    return 85
  }

  const sourceTokens = new Set(normalizedSource.split(' '))
  const categoryTokens = new Set(normalizedCategory.split(' '))
  const sharedCount = [...sourceTokens].filter((token) => categoryTokens.has(token)).length
  const smallerTokenCount = Math.min(sourceTokens.size, categoryTokens.size)
  const largerTokenCount = Math.max(sourceTokens.size, categoryTokens.size)

  if (smallerTokenCount >= 2 && sharedCount === smallerTokenCount) return 80
  if (sharedCount / smallerTokenCount >= 0.67 && sharedCount / largerTokenCount >= 0.5) return 70

  return 0
}

function normalizeCategoryName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
