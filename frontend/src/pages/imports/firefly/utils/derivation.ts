import type { AccountType } from '@/api/accounts'
import type { Category } from '@/api/categories'
import { FIREFLY_NO_CATEGORY_SOURCE, isFireflyTrackedAccountType } from '@/api/firefly-imports'
import {
  CREATE_CATEGORY_VALUE,
  getRowNotesTooLongReason,
  getRowTooManyTagsReason,
  MAX_IMPORT_NOTES_LENGTH,
  MAX_IMPORT_TAGS_PER_ROW,
} from '@/pages/imports/constants'
import type { CsvRow, ImportCategoryKind } from '@/pages/imports/types'
import {
  FIREFLY_FALLBACK_ACCOUNT_TYPE,
  FIREFLY_LIABILITY_ACCOUNT_TYPES,
  FIREFLY_MISCELLANEOUS_CATEGORY_NAME,
  FIREFLY_TAG_NAME_MAX_LENGTH,
  FIREFLY_TYPE_DEPOSIT,
  FIREFLY_TYPE_TRANSFER,
  FIREFLY_TYPE_WITHDRAWAL,
} from '@/pages/imports/firefly/constants'
import type { FireflyAccountPrefill } from '@/pages/imports/firefly/types'
import { parseYmd } from '@/utils/date'

/**
 * Extracts the date part of a Firefly III timestamp, empty when unparseable
 *
 * A well-shaped value that is not a real date, like the 31st of February, is
 * unparseable too, so such rows fail here instead of failing the whole
 * upload batch on the backend
 */
export function getFireflyRowDate(value: string) {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/)
  if (!match || !parseYmd(match[1])) return ''
  return match[1]
}

/**
 * Checks that a journal row carries the fields the import endpoint requires
 */
export function isFireflyRowImportable(row: CsvRow) {
  return getFireflyMissingRequiredFields(row).length === 0
}

/**
 * Names the required identity fields a row is missing, in the plain words
 * the skipped-row reason shows to the user
 */
export function getFireflyMissingRequiredFields(row: CsvRow) {
  const missingFields: string[] = []
  if (!row.journal_id?.trim()) missingFields.push('journal id')
  if (!getFireflyRowDate(row.date ?? '')) missingFields.push('date')
  if (!row.amount?.trim()) missingFields.push('amount')
  if ((row.currency_code?.trim().length ?? 0) !== 3) missingFields.push('currency')
  return missingFields
}

/**
 * Returns the first tag on a row that is too long for a Lumina tag, or null
 */
export function getFireflyOverlongTag(row: CsvRow): string | null {
  return splitFireflyTags(row.tags ?? '').find((tag) => tag.length > FIREFLY_TAG_NAME_MAX_LENGTH) ?? null
}

/**
 * Returns why a row carries more than one transaction may hold, or null
 *
 * The API refuses the whole request for either, and a Firefly import commits
 * each batch as it goes, so one such row part-way through an export would
 * leave the batches before it in the ledger with no way to retry the rest.
 * Dropping the row before upload is what the overlong tag above already does
 */
export function getFireflyRowOverLimitReason(row: CsvRow): string | null {
  const tagCount = splitFireflyTags(row.tags ?? '').length
  if (tagCount > MAX_IMPORT_TAGS_PER_ROW) return getRowTooManyTagsReason(tagCount)

  const notesLength = row.notes?.trim().length ?? 0
  if (notesLength > MAX_IMPORT_NOTES_LENGTH) return getRowNotesTooLongReason(notesLength)
  return null
}

/**
 * Whether a row survives the payload build and reaches the backend
 *
 * Anything deriving import sources, such as the budget category inference,
 * must gate on this, because a row dropped before upload can never register
 * an account or category source in the commit response
 */
export function isFireflyRowUploadable(row: CsvRow): boolean {
  return isFireflyRowImportable(row)
    && getFireflyOverlongTag(row) === null
    && getFireflyRowOverLimitReason(row) === null
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
 * Builds create-new type and currency defaults for every tracked account name
 *
 * @param supportedCurrencyCodes - Every code the app can store an account in. A row stating
 *   anything else is not counted, since the currency control offers only these: prefilling one it
 *   does not offer leaves the box showing its placeholder while the count above the table reads the
 *   row as answered, and the commit then sends the server a currency it refuses
 */
export function buildFireflyAccountPrefills(
  rows: CsvRow[],
  trackedAccountNames: string[],
  supportedCurrencyCodes: Set<string>,
): Record<string, FireflyAccountPrefill> {
  const currencyTallies = new Map<string, Map<string, number>>()
  const overallTally = new Map<string, number>()
  const liabilityTypes = new Map<string, AccountType>()

  const readSupportedCurrency = (value: string | undefined) => {
    const code = value?.trim().toUpperCase() ?? ''
    return supportedCurrencyCodes.has(code) ? code : ''
  }

  const tallyCurrency = (accountName: string | undefined, currency: string) => {
    if (!accountName || !currency) return
    const tally = currencyTallies.get(accountName) ?? new Map<string, number>()
    tally.set(currency, (tally.get(currency) ?? 0) + 1)
    currencyTallies.set(accountName, tally)
  }

  // Liability endpoint types name the Lumina account type directly, while
  // asset accounts fall back to checking because rows carry no role details
  const recordLiabilityType = (accountName: string | undefined, endpointType: string | undefined) => {
    if (!accountName || liabilityTypes.has(accountName)) return
    const mappedType = FIREFLY_LIABILITY_ACCOUNT_TYPES[endpointType?.trim().toLowerCase() ?? '']
    if (mappedType) liabilityTypes.set(accountName, mappedType)
  }

  // The account-side currency follows money direction, so withdrawals and
  // transfers vote with the source and deposits vote with the destination,
  // where a transfer destination prefers the foreign currency when present
  for (const row of rows) {
    const journalType = row.type?.trim().toLowerCase() ?? ''
    const rowCurrency = readSupportedCurrency(row.currency_code)
    if (rowCurrency) overallTally.set(rowCurrency, (overallTally.get(rowCurrency) ?? 0) + 1)

    const sourceName = isFireflyTrackedAccountType(row.source_type) ? row.source_name?.trim() : ''
    const destinationName = isFireflyTrackedAccountType(row.destination_type) ? row.destination_name?.trim() : ''
    recordLiabilityType(sourceName, row.source_type)
    recordLiabilityType(destinationName, row.destination_type)

    if (journalType === FIREFLY_TYPE_WITHDRAWAL || journalType === FIREFLY_TYPE_TRANSFER) {
      tallyCurrency(sourceName, rowCurrency)
    }
    if (journalType === FIREFLY_TYPE_DEPOSIT) {
      tallyCurrency(destinationName, rowCurrency)
    }
    if (journalType === FIREFLY_TYPE_TRANSFER) {
      tallyCurrency(destinationName, readSupportedCurrency(row.foreign_currency_code) || rowCurrency)
    }
  }

  const fallbackCurrency = getTopTallyValue(overallTally)
  const prefills: Record<string, FireflyAccountPrefill> = {}

  for (const name of trackedAccountNames) {
    prefills[name] = {
      accountType: liabilityTypes.get(name) ?? FIREFLY_FALLBACK_ACCOUNT_TYPE,
      currency: getTopTallyValue(currencyTallies.get(name)) || fallbackCurrency,
    }
  }

  return prefills
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

  // Rows without a category have no name to match on, so they fall to the
  // seeded catch-all rather than inventing a category of their own
  const miscellaneous = categories.find((category) => (
    category.is_system && category.name === FIREFLY_MISCELLANEOUS_CATEGORY_NAME
  ))

  const next: Record<string, string> = {}
  for (const source of importedCategories) {
    if (explicitMappings[source]) {
      next[source] = explicitMappings[source]
      continue
    }

    if (source === FIREFLY_NO_CATEGORY_SOURCE) {
      next[source] = miscellaneous ? miscellaneous.id : CREATE_CATEGORY_VALUE
      continue
    }

    const matches = categoriesByName.get(source.trim().toLowerCase()) ?? []
    const match = matches.find((category) => category.kind === categoryKinds[source]) ?? matches[0]
    next[source] = match ? match.id : CREATE_CATEGORY_VALUE
  }

  return next
}

