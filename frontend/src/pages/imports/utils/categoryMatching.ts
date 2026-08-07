import type { Category } from '@/api/categories'
import { CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
import type { ImportCategoryKind, ImportFileDraft } from '@/pages/imports/types'
import { parseImportNumber } from './valueParsers'

/**
 * Breaks a cell holding several values into the individual ones, accepting semicolons, commas or
 * pipes as the separator and dropping anything blank
 */
export function splitImportedValues(value: string) {
  return value
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * Reads each imported category name as income or expense by looking at the signs of the amounts
 * filed against it, labelling a name Mixed when both signs appear
 *
 * Rows with an amount of zero or an amount that cannot be read are ignored, since neither says
 * anything about direction, and every name is left blank until both the category and amount columns
 * have been mapped
 */
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

/**
 * Drops every match pointing at a category that no longer exists, and says which names lost one
 *
 * The create-new answer is left alone, or a name queued for a new category would be cleared the
 * moment it was answered
 *
 * @param mappings - The matches as stored, before any guess is layered on
 * @param categoryById - Every category the user has
 */
export function dropVanishedCategoryMappings(
  mappings: Record<string, string>,
  categoryById: Map<string, Category>,
) {
  const kept: Record<string, string> = {}
  const clearedSources = new Set<string>()

  for (const [source, choice] of Object.entries(mappings)) {
    const isCategoryId = Boolean(choice) && choice !== CREATE_CATEGORY_VALUE
    if (isCategoryId && !categoryById.has(choice)) {
      clearedSources.add(source)
      continue
    }

    kept[source] = choice
  }

  return { mappings: kept, clearedSources }
}

/**
 * Lines a map of matches up with the values currently present in the imported files, keeping the
 * matches that still apply, adding blanks for new values and dropping ones that have gone away
 *
 * The original map is returned untouched when nothing needed to change, so re-reading the same files
 * does not restart the work that depends on this map
 */
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

/**
 * Guesses which existing category each imported category name belongs to, filling only the names the
 * user has not already matched by hand
 *
 * Matched on the name alone. The direction read from the amounts does not narrow the candidates,
 * because a category's direction does not bound the signs of the rows filed under it: a refund sits
 * in an expense category and a clawback in an income one. Where several categories score equally,
 * the user's own wins over a group's and a group's over one that ships with the app, and a name
 * still tied after that is left unmatched rather than settled by chance
 */
export function inferCategoryMappings(
  importedCategories: string[],
  current: Record<string, string>,
  categories: Category[],
) {
  const next = { ...keepCurrentMatchMap(current, importedCategories) }

  for (const source of importedCategories) {
    if (next[source]) continue

    const match = findBestCategoryNameMatch(source, categories)
    if (match) next[source] = match.id
  }

  return next
}

/**
 * Works out whether a matched category counts as income, an expense or a transfer, taking the kind
 * from the selected category when one exists and otherwise from what the user chose to create
 *
 * Where no existing category is selected and no kind has been chosen for the one to create, the kind
 * read from the signs of the imported amounts is used so the row shows a default instead of nothing
 */
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

/**
 * Reports whether a category selection points at a category that already exists, which is false both
 * when nothing is selected and when the selection is the placeholder standing for a new category
 */
export function isExistingCategoryMatch(value: string) {
  return Boolean(value && value !== CREATE_CATEGORY_VALUE)
}

/**
 * The key a category name is matched under, which is the name trimmed of surrounding spaces with
 * its capitals folded, matching what the commit compares and what the database enforces
 */
export function getCategoryNameKey(name: string) {
  return name.trim().toLowerCase()
}

/**
 * Finds the category a source answered "create new" would actually land on
 *
 * The commit reuses a category of the same name rather than writing a second one, so a row answered
 * create is judged against this rather than against the name in the file. Group categories are left
 * out because the commit does not reuse them: a file naming one still creates a personal category.
 * A user's own category wins over one that ships with the app, which is the order the commit reads
 * its candidates in
 *
 * @param source - The category value as the file spells it
 * @param categories - Every category the user has
 */
export function findReusedImportCategory(source: string, categories: Iterable<Category>) {
  const key = getCategoryNameKey(source)
  let systemMatch: Category | undefined

  for (const category of categories) {
    if (category.group_id || getCategoryNameKey(category.name) !== key) continue
    if (!category.is_system) return category
    systemMatch ??= category
  }

  return systemMatch
}

function getCategoryKindFromTypeLabel(categoryType: string | undefined): ImportCategoryKind | '' {
  if (categoryType === 'Transfer') return 'transfer'
  if (categoryType === 'Income') return 'income'
  if (categoryType === 'Expense') return 'expense'
  return ''
}

function findBestCategoryNameMatch(source: string, categories: Category[]) {
  let bestMatch: { category: Category; score: number; scopeRank: number } | null = null
  let tied = false

  for (const category of categories) {
    const score = scoreCategoryNameMatch(source, category.name)
    if (score <= 0) continue

    const scopeRank = getCategoryScopeRank(category)
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { category, score, scopeRank }
      tied = false
      continue
    }

    if (score < bestMatch.score) continue

    // Two categories can share a name across scopes, since each scope is unique on its own, so the
    // closer one settles it rather than the row being left unanswered
    if (scopeRank < bestMatch.scopeRank) {
      bestMatch = { category, score, scopeRank }
      tied = false
      continue
    }

    if (scopeRank === bestMatch.scopeRank) tied = true
  }

  return bestMatch && !tied ? bestMatch.category : null
}

/**
 * How close a category is to the user, which settles a match two categories score equally on: their
 * own first, then one their group shares, then one that ships with the app
 */
function getCategoryScopeRank(category: Category) {
  if (category.is_system) return 2
  return category.group_id ? 1 : 0
}

function scoreCategoryNameMatch(source: string, categoryName: string) {
  const normalizedSource = normalizeCategoryName(source)
  const normalizedCategory = normalizeCategoryName(categoryName)
  if (!normalizedSource || !normalizedCategory) return 0

  if (normalizedSource === normalizedCategory) return 100

  // Below an exact match rather than equal to it, so a value reading "Pet Care" takes the category
  // spelled that way over one spelled "Petcare". Scored the same, the two would tie and the value
  // would be left unanswered, which is what the direction read off the amounts used to prevent
  const compactSource = normalizedSource.replace(/\s/g, '')
  const compactCategory = normalizedCategory.replace(/\s/g, '')
  if (compactSource === compactCategory) return 95

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
