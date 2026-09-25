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
  FIREFLY_ROW_FIELD_MAX_LENGTHS,
  FIREFLY_TAG_NAME_MAX_LENGTH,
  FIREFLY_TYPE_DEPOSIT,
  FIREFLY_TYPE_TRANSFER,
  FIREFLY_TYPE_WITHDRAWAL,
} from '@/pages/imports/firefly/constants'
import type { FireflyAccountPrefill, FireflyAccountSource, FireflyAccountSources } from '@/pages/imports/firefly/types'
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
  if (!row.type?.trim()) missingFields.push('type')
  if (!getFireflyRowDate(row.date ?? '')) missingFields.push('date')

  // The foreign amount stands in when the main one cannot be read, so the row lacks an amount only
  // when neither can
  if (!getFireflyRowAmounts(row).main) {
    if (!row.amount?.trim()) missingFields.push('amount')
    if (!readFireflyCurrencyCode(row.currency_code)) missingFields.push('currency')
  }
  return missingFields
}

/** One amount a row states, with the currency it is in */
export interface FireflyCurrencyAmount {
  amount: string
  currencyCode: string
}

/**
 * Reads a row's amount and foreign amount, each kept only with an amount and a three-letter code
 *
 * Firefly III takes custom currency codes of other lengths, such as USDT, which no Lumina account
 * is kept in, so an amount in one can never be the one a row is written with. When the main amount
 * is one of those and the foreign amount is not, the foreign amount takes its place
 *
 * @returns The amount the row is sent with, and the foreign amount beside it, each null when absent
 */
export function getFireflyRowAmounts(row: CsvRow): {
  main: FireflyCurrencyAmount | null
  foreign: FireflyCurrencyAmount | null
} {
  const main = readFireflyCurrencyAmount(row.amount, row.currency_code)
  const foreign = readFireflyCurrencyAmount(row.foreign_amount, row.foreign_currency_code)
  return main ? { main, foreign } : { main: foreign, foreign: null }
}

function readFireflyCurrencyAmount(amount: string | undefined, currencyCode: string | undefined) {
  const trimmedAmount = amount?.trim() ?? ''
  const code = readFireflyCurrencyCode(currencyCode)
  return trimmedAmount && code ? { amount: trimmedAmount, currencyCode: code } : null
}

function readFireflyCurrencyCode(value: string | undefined) {
  const code = value?.trim().toUpperCase() ?? ''
  return /^[A-Z]{3}$/.test(code) ? code : ''
}

/**
 * Whether an endpoint is an account the import writes to, which takes a name and a tracked type
 */
function isFireflyTrackedEndpoint(name: string | undefined, type: string | undefined) {
  return Boolean(name?.trim()) && isFireflyTrackedAccountType(type)
}

/**
 * Whether a row is a withdrawal or deposit between an imported account and one outside the import
 *
 * Only such a row is written with a merchant and its own category. A row between two imported
 * accounts is a transfer, and a balance row takes Balance Adjustment
 */
export function isFireflyPayeeRow(row: CsvRow) {
  const journalType = row.type?.trim().toLowerCase() ?? ''
  const isSourceTracked = isFireflyTrackedEndpoint(row.source_name, row.source_type)
  const isDestinationTracked = isFireflyTrackedEndpoint(row.destination_name, row.destination_type)

  if (journalType === FIREFLY_TYPE_WITHDRAWAL) return isSourceTracked && !isDestinationTracked
  if (journalType === FIREFLY_TYPE_DEPOSIT) return isDestinationTracked && !isSourceTracked
  return false
}

/**
 * Returns the name a payee row's merchant is filed under, blank when the export gives none, and
 * null for any other row, which is written with no merchant of its own
 */
export function getFireflyRowPayeeName(row: CsvRow): string | null {
  if (!isFireflyPayeeRow(row)) return null

  const journalType = row.type?.trim().toLowerCase() ?? ''
  const name = journalType === FIREFLY_TYPE_WITHDRAWAL ? row.destination_name : row.source_name
  return name?.trim() ?? ''
}

/**
 * Returns the first tag on a row that is too long for a Lumina tag, or null
 */
export function getFireflyOverlongTag(row: CsvRow): string | null {
  return splitFireflyTags(row.tags ?? '').find((tag) => countCharacters(tag) > FIREFLY_TAG_NAME_MAX_LENGTH) ?? null
}

/**
 * Counts a value's characters the way the import endpoint measures its length limits
 *
 * The endpoint counts code points, while a JavaScript string length counts UTF-16 units, which
 * would put an emoji at two characters and drop rows the endpoint takes
 */
export function countCharacters(value: string): number {
  return [...value].length
}

/**
 * Returns why a row holds a value past what the import endpoint takes, or null
 *
 * The API refuses the whole request for any of them, and a Firefly import commits
 * each batch as it goes, so one such row part-way through an export would
 * leave the batches before it in the ledger with no way to retry the rest.
 * Dropping the row before upload is what the overlong tag above already does
 */
export function getFireflyRowOverLimitReason(row: CsvRow): string | null {
  const tagCount = splitFireflyTags(row.tags ?? '').length
  if (tagCount > MAX_IMPORT_TAGS_PER_ROW) return getRowTooManyTagsReason(tagCount)

  const notesLength = countCharacters(row.notes?.trim() ?? '')
  if (notesLength > MAX_IMPORT_NOTES_LENGTH) return getRowNotesTooLongReason(notesLength)

  // Only the amounts the row is sent with are checked, since an amount in a code Lumina cannot
  // hold is left out of the upload
  const { main, foreign } = getFireflyRowAmounts(row)
  const limits = FIREFLY_ROW_FIELD_MAX_LENGTHS
  const fields: [string, string | null | undefined, number][] = [
    ['journal id', row.journal_id, limits.journalId],
    ['type', row.type, limits.type],
    ['amount', main?.amount, limits.amount],
    ['foreign amount', foreign?.amount, limits.amount],
    ['description', row.description, limits.description],
    ['category', row.category, limits.category],

    // Only the payee that becomes the merchant is sent, so a long name anywhere else costs nothing
    ['payee name', getFireflyRowPayeeName(row), limits.payee],
  ]
  for (const [field, value, maxLength] of fields) {
    const length = countCharacters(value?.trim() ?? '')
    if (length > maxLength) return getFireflyFieldTooLongReason(field, length, maxLength)
  }
  return null
}

/**
 * Says a row field is longer than the import endpoint takes
 */
function getFireflyFieldTooLongReason(field: string, length: number, maxLength: number) {
  return `The ${field} is ${length.toLocaleString()} characters, and the importer takes up to ${maxLength.toLocaleString()}.`
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
 * Gets the accounts the export's rows are written to, each told apart by its Firefly III type as
 * well as its name, since Firefly III lets an asset account and a liability share a name
 *
 * Every mapping, create-new choice and payload row names an account by its id, so the ids only
 * need to hold for one export, and replacing the export starts the mappings over
 */
export function getFireflyAccountSources(rows: CsvRow[]): FireflyAccountSources {
  const endpoints = new Map<string, { name: string; type: string }>()

  const addEndpoint = (name: string | undefined, type: string | undefined) => {
    const trimmedName = name?.trim() ?? ''
    if (!trimmedName || !type || !isFireflyTrackedAccountType(type)) return

    const key = getFireflyAccountKey(trimmedName, type)
    if (!endpoints.has(key)) endpoints.set(key, { name: trimmedName, type: type.trim() })
  }

  for (const row of rows) {
    addEndpoint(row.source_name, row.source_type)
    addEndpoint(row.destination_name, row.destination_type)
  }

  const sorted = [...endpoints].sort(([, a], [, b]) => (
    a.name.localeCompare(b.name) || a.type.localeCompare(b.type)
  ))

  const typeCountByName = new Map<string, number>()
  for (const [, endpoint] of sorted) {
    typeCountByName.set(endpoint.name, (typeCountByName.get(endpoint.name) ?? 0) + 1)
  }

  const sourceByKey = new Map<string, FireflyAccountSource>()
  const list = sorted.map(([key, endpoint], index) => {
    const source = {
      id: `account-${index + 1}`,
      name: endpoint.name,
      type: endpoint.type,
      label: (typeCountByName.get(endpoint.name) ?? 0) > 1 ? `${endpoint.name} (${endpoint.type})` : endpoint.name,
    }
    sourceByKey.set(key, source)
    return source
  })

  return {
    list,
    find: (name, type) => sourceByKey.get(getFireflyAccountKey(name?.trim() ?? '', type ?? '')) ?? null,
  }
}

/**
 * Keys an endpoint by its name and its type, reading the type as Firefly III matches it
 */
function getFireflyAccountKey(name: string, type: string) {
  return JSON.stringify([name, type.trim().toLowerCase()])
}

/**
 * Builds create-new type and currency defaults for every tracked account, keyed by source id
 *
 * @param supportedCurrencyCodes - Every code the app can store an account in. A row stating
 *   anything else is not counted, since the currency control offers only these: prefilling one it
 *   does not offer leaves the box showing its placeholder while the count above the table reads the
 *   row as answered, and the commit then sends the server a currency it refuses
 */
export function buildFireflyAccountPrefills(
  rows: CsvRow[],
  accountSources: FireflyAccountSources,
  supportedCurrencyCodes: Set<string>,
): Record<string, FireflyAccountPrefill> {
  const currencyTallies = new Map<string, Map<string, number>>()
  const overallTally = new Map<string, number>()

  const readSupportedCurrency = (value: string | undefined) => {
    const code = value?.trim().toUpperCase() ?? ''
    return supportedCurrencyCodes.has(code) ? code : ''
  }

  const tallyCurrency = (source: FireflyAccountSource | null, currency: string) => {
    if (!source || !currency) return
    const tally = currencyTallies.get(source.id) ?? new Map<string, number>()
    tally.set(currency, (tally.get(currency) ?? 0) + 1)
    currencyTallies.set(source.id, tally)
  }

  // The account-side currency follows money direction, so withdrawals and
  // transfers vote with the source and deposits vote with the destination,
  // where a transfer destination prefers the foreign currency when present
  for (const row of rows) {
    const journalType = row.type?.trim().toLowerCase() ?? ''
    const rowCurrency = readSupportedCurrency(row.currency_code)
    if (rowCurrency) overallTally.set(rowCurrency, (overallTally.get(rowCurrency) ?? 0) + 1)

    const source = accountSources.find(row.source_name, row.source_type)
    const destination = accountSources.find(row.destination_name, row.destination_type)

    if (journalType === FIREFLY_TYPE_WITHDRAWAL || journalType === FIREFLY_TYPE_TRANSFER) {
      tallyCurrency(source, rowCurrency)
    }
    if (journalType === FIREFLY_TYPE_DEPOSIT) {
      tallyCurrency(destination, rowCurrency)
    }
    if (journalType === FIREFLY_TYPE_TRANSFER) {
      tallyCurrency(destination, readSupportedCurrency(row.foreign_currency_code) || rowCurrency)
    }
  }

  const fallbackCurrency = getTopTallyValue(overallTally)
  const prefills: Record<string, FireflyAccountPrefill> = {}

  // Liability types name the Lumina account type directly, while asset accounts fall back to
  // checking because rows carry no role details
  for (const source of accountSources.list) {
    prefills[source.id] = {
      accountType: FIREFLY_LIABILITY_ACCOUNT_TYPES[source.type.toLowerCase()] ?? FIREFLY_FALLBACK_ACCOUNT_TYPE,
      currency: getTopTallyValue(currencyTallies.get(source.id)) || fallbackCurrency,
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

