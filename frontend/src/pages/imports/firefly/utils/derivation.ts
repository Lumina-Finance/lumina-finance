import type { Category } from '@/api/categories'
import { FIREFLY_NO_CATEGORY_SOURCE, isFireflyTrackedAccountType } from '@/api/dataImports'
import { CREATE_CATEGORY_VALUE } from '../../constants'
import type { CsvRow, ImportCategoryKind, ImportFileDraft } from '../../types'
import {
  FIREFLY_ASSET_ROLE_ACCOUNT_TYPES,
  FIREFLY_FALLBACK_ACCOUNT_TYPE,
  FIREFLY_LIABILITY_ACCOUNT_TYPES,
} from '../constants'
import type { FireflyAccountPrefill, FireflyImportEstimate, FireflySampleRow } from '../types'

const FIREFLY_TYPE_WITHDRAWAL = 'withdrawal'
const FIREFLY_TYPE_DEPOSIT = 'deposit'
const FIREFLY_TYPE_TRANSFER = 'transfer'
const FIREFLY_TYPE_OPENING_BALANCE = 'opening balance'
const FIREFLY_TYPE_RECONCILIATION = 'reconciliation'

/**
 * Metadata for one account row from the optional Firefly III accounts export
 */
interface FireflyAccountsCsvRecord {
  accountType: string
  role: string
  currencyCode: string
}

/**
 * Extracts the date part of a Firefly III timestamp, empty when unparseable
 */
export function getFireflyRowDate(value: string) {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : ''
}

/**
 * Checks that a journal row carries the fields the import endpoint requires
 */
export function isFireflyRowImportable(row: CsvRow) {
  return Boolean(
    row.journal_id?.trim()
    && getFireflyRowDate(row.date ?? '')
    && row.amount?.trim()
    && (row.currency_code?.trim().length ?? 0) === 3,
  )
}

/**
 * Splits a Firefly III comma-joined tags cell into unique tag names
 */
export function splitFireflyTags(value: string) {
  const tags = value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
  return Array.from(new Set(tags))
}

/**
 * Gets the sorted distinct account names that must be mapped to Lumina accounts
 */
export function getFireflyTrackedAccountNames(rows: CsvRow[]): string[] {
  const names = new Set<string>()

  for (const row of rows) {
    const sourceName = row.source_name?.trim()
    if (sourceName && isFireflyTrackedAccountType(row.source_type)) names.add(sourceName)

    const destinationName = row.destination_name?.trim()
    if (destinationName && isFireflyTrackedAccountType(row.destination_type)) names.add(destinationName)
  }

  return [...names].sort((a, b) => a.localeCompare(b))
}

/**
 * Indexes the optional accounts export by account name for create-new prefills
 */
export function buildFireflyAccountsCsvIndex(accountsFile: ImportFileDraft | null) {
  const index = new Map<string, FireflyAccountsCsvRecord>()
  if (!accountsFile || accountsFile.error) return index

  for (const row of accountsFile.rows) {
    const name = row.name?.trim()
    if (!name || index.has(name)) continue
    index.set(name, {
      accountType: row.type?.trim() ?? '',
      role: row.role?.trim() ?? '',
      currencyCode: row.currency_code?.trim().toUpperCase() ?? '',
    })
  }

  return index
}

/**
 * Builds create-new type and currency defaults for every tracked account name
 */
export function buildFireflyAccountPrefills(
  rows: CsvRow[],
  trackedAccountNames: string[],
  accountsCsvIndex: Map<string, FireflyAccountsCsvRecord>,
): Record<string, FireflyAccountPrefill> {
  const currencyTallies = new Map<string, Map<string, number>>()
  const overallTally = new Map<string, number>()

  const tallyCurrency = (accountName: string | undefined, currency: string) => {
    if (!accountName || !currency) return
    const tally = currencyTallies.get(accountName) ?? new Map<string, number>()
    tally.set(currency, (tally.get(currency) ?? 0) + 1)
    currencyTallies.set(accountName, tally)
  }

  // The account-side currency follows money direction, so withdrawals and
  // transfers vote with the source and deposits vote with the destination,
  // where a transfer destination prefers the foreign currency when present
  for (const row of rows) {
    const journalType = row.type?.trim().toLowerCase() ?? ''
    const rowCurrency = row.currency_code?.trim().toUpperCase() ?? ''
    if (rowCurrency) overallTally.set(rowCurrency, (overallTally.get(rowCurrency) ?? 0) + 1)

    const sourceName = isFireflyTrackedAccountType(row.source_type) ? row.source_name?.trim() : ''
    const destinationName = isFireflyTrackedAccountType(row.destination_type) ? row.destination_name?.trim() : ''

    if (journalType === FIREFLY_TYPE_WITHDRAWAL || journalType === FIREFLY_TYPE_TRANSFER) {
      tallyCurrency(sourceName, rowCurrency)
    }
    if (journalType === FIREFLY_TYPE_DEPOSIT) {
      tallyCurrency(destinationName, rowCurrency)
    }
    if (journalType === FIREFLY_TYPE_TRANSFER) {
      tallyCurrency(destinationName, row.foreign_currency_code?.trim().toUpperCase() || rowCurrency)
    }
  }

  const fallbackCurrency = getTopTallyValue(overallTally)
  const prefills: Record<string, FireflyAccountPrefill> = {}

  for (const name of trackedAccountNames) {
    const record = accountsCsvIndex.get(name)
    prefills[name] = {
      accountType: record ? getFireflyAccountTypePrefill(record) : FIREFLY_FALLBACK_ACCOUNT_TYPE,
      currency: record?.currencyCode || getTopTallyValue(currencyTallies.get(name)) || fallbackCurrency,
    }
  }

  return prefills
}

/**
 * Maps a Firefly III account type and role onto the closest Lumina account type
 */
function getFireflyAccountTypePrefill(record: FireflyAccountsCsvRecord) {
  const accountType = record.accountType.toLowerCase()
  if (accountType === 'asset account') {
    return FIREFLY_ASSET_ROLE_ACCOUNT_TYPES[record.role] ?? FIREFLY_FALLBACK_ACCOUNT_TYPE
  }
  return FIREFLY_LIABILITY_ACCOUNT_TYPES[accountType] ?? FIREFLY_FALLBACK_ACCOUNT_TYPE
}

/**
 * Picks the most frequent tally value, breaking ties alphabetically
 */
function getTopTallyValue(tally: Map<string, number> | undefined) {
  if (!tally) return ''
  let top = ''
  let topCount = 0

  for (const [value, count] of tally) {
    if (count > topCount || (count === topCount && value < top)) {
      top = value
      topCount = count
    }
  }

  return top
}

/**
 * Gets the sorted distinct category sources, including the no-category
 * placeholder the backend requires when rows without a category exist
 */
export function getFireflyImportedCategories(rows: CsvRow[]): string[] {
  const categories = new Set<string>()
  let hasUncategorizedRows = false

  for (const row of rows) {
    const category = row.category?.trim()
    if (category) {
      categories.add(category)
    } else {
      hasUncategorizedRows = true
    }
  }

  const sorted = [...categories].sort((a, b) => a.localeCompare(b))
  if (hasUncategorizedRows) sorted.push(FIREFLY_NO_CATEGORY_SOURCE)
  return sorted
}

/**
 * Infers a create kind per category source from majority journal-type usage,
 * where withdrawals vote expense, deposits vote income, and ties stay expense
 */
export function buildFireflyCategoryKinds(rows: CsvRow[]): Record<string, ImportCategoryKind> {
  const votes = new Map<string, { expense: number; income: number }>()

  for (const row of rows) {
    const journalType = row.type?.trim().toLowerCase() ?? ''
    if (journalType !== FIREFLY_TYPE_WITHDRAWAL && journalType !== FIREFLY_TYPE_DEPOSIT) continue

    const source = row.category?.trim() || FIREFLY_NO_CATEGORY_SOURCE
    const tally = votes.get(source) ?? { expense: 0, income: 0 }
    if (journalType === FIREFLY_TYPE_WITHDRAWAL) {
      tally.expense += 1
    } else {
      tally.income += 1
    }
    votes.set(source, tally)
  }

  const kinds: Record<string, ImportCategoryKind> = {}
  for (const [source, tally] of votes) {
    kinds[source] = tally.income > tally.expense ? 'income' : 'expense'
  }
  return kinds
}

/**
 * Matches category sources to existing categories by case-insensitive name,
 * preferring the inferred kind on duplicates, and defaults the rest to create
 */
export function inferFireflyCategoryMappings(
  importedCategories: string[],
  explicitMappings: Record<string, string>,
  categories: Category[],
  categoryKinds: Record<string, ImportCategoryKind>,
): Record<string, string> {
  const categoriesByName = new Map<string, Category[]>()
  for (const category of categories) {
    const key = category.name.trim().toLowerCase()
    const bucket = categoriesByName.get(key) ?? []
    bucket.push(category)
    categoriesByName.set(key, bucket)
  }

  const next: Record<string, string> = {}
  for (const source of importedCategories) {
    if (explicitMappings[source]) {
      next[source] = explicitMappings[source]
      continue
    }

    const matches = categoriesByName.get(source.trim().toLowerCase()) ?? []
    const match = matches.find((category) => category.kind === categoryKinds[source]) ?? matches[0]
    next[source] = match ? match.id : CREATE_CATEGORY_VALUE
  }

  return next
}

/**
 * Counts importable rows and estimates the transactions the backend will
 * create, where rows between two mapped accounts produce two legs
 */
export function estimateFireflyImport(rows: CsvRow[]): FireflyImportEstimate {
  let rowCount = 0
  let invalidRowCount = 0
  let transactionEstimate = 0
  let skipRiskCount = 0

  for (const row of rows) {
    if (!isFireflyRowImportable(row)) {
      invalidRowCount += 1
      continue
    }
    rowCount += 1

    const legs = estimateFireflyRowLegs(row)
    transactionEstimate += legs
    if (legs === 0) skipRiskCount += 1
  }

  return { rowCount, invalidRowCount, transactionEstimate, skipRiskCount }
}

/**
 * Mirrors the backend leg resolution order to estimate transactions per row
 */
function estimateFireflyRowLegs(row: CsvRow) {
  const journalType = row.type?.trim().toLowerCase() ?? ''
  const sourceTracked = Boolean(row.source_name?.trim()) && isFireflyTrackedAccountType(row.source_type)
  const destinationTracked = Boolean(row.destination_name?.trim()) && isFireflyTrackedAccountType(row.destination_type)

  if (journalType === FIREFLY_TYPE_OPENING_BALANCE || journalType === FIREFLY_TYPE_RECONCILIATION) {
    return sourceTracked || destinationTracked ? 1 : 0
  }
  if (sourceTracked && destinationTracked) return 2
  if (journalType === FIREFLY_TYPE_WITHDRAWAL) return sourceTracked ? 1 : 0
  if (journalType === FIREFLY_TYPE_DEPOSIT) return destinationTracked ? 1 : 0
  return 0
}

/**
 * Compiles the first importable rows into the capped preview shape
 */
export function buildFireflySampleRows(rows: CsvRow[], limit: number): FireflySampleRow[] {
  const samples: FireflySampleRow[] = []

  for (const row of rows) {
    if (samples.length >= limit) break
    if (!isFireflyRowImportable(row)) continue

    samples.push({
      journalId: row.journal_id.trim(),
      dt: getFireflyRowDate(row.date ?? ''),
      type: row.type?.trim() ?? '',
      description: row.description?.trim() ?? '',
      amount: row.amount.trim(),
      currencyCode: row.currency_code.trim().toUpperCase(),
      endpoints: `${row.source_name?.trim() || '(none)'} to ${row.destination_name?.trim() || '(none)'}`,
      category: row.category?.trim() || FIREFLY_NO_CATEGORY_SOURCE,
    })
  }

  return samples
}
