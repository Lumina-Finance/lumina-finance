import { COLUMN_TARGETS } from '@/pages/imports/constants'
import type { ColumnMap, ColumnTarget, ImportFileDraft } from '@/pages/imports/types'
import { unique } from './common'
import { validateColumnMap, validateColumnValues } from './columnMapping'
import { isSupportedCurrency, isValidAmountValue, isValidDateValue } from './valueParsers'

const HEADER_ALIAS_SCORES: Record<ColumnTarget, Record<string, number>> = {
  account_id: {
    account: 100,
    accountname: 100,
    sourceaccount: 100,
    sourceaccountname: 100,
    bankaccount: 85,
    card: 70,
    cardname: 70,
  },
  dt: {
    date: 100,
    transactiondate: 100,
    transdate: 95,
    postingdate: 95,
    posteddate: 95,
    valuedate: 90,
    effectivedate: 90,
    datetime: 85,
  },
  category_id: {
    category: 100,
    categoryname: 100,
    transactioncategory: 95,
  },
  amount: {
    amount: 100,
    transactionamount: 100,
    rawamount: 100,
    signedamount: 100,
    value: 75,
    total: 65,
  },
  currency: {
    currency: 100,
    currencycode: 100,
    curr: 90,
    iso: 70,
  },
  merchant_id: {
    merchant: 100,
    merchantname: 100,
    payee: 95,
    payeename: 95,
    vendor: 90,
    vendorname: 90,
    counterparty: 85,
    description: 65,
    transactiondescription: 65,
    name: 50,
  },
  notes: {
    notes: 100,
    note: 100,
    memo: 95,
    comments: 90,
    comment: 90,
    reference: 80,
    details: 75,
    detail: 75,
    description: 45,
    transactiondescription: 45,
  },
  tag_ids: {
    tags: 100,
    tag: 100,
    labels: 90,
    label: 90,
  },
  counterparty_account_id: {
    counterpartyaccount: 100,
    counterpartyaccountname: 95,
    otheraccount: 100,
    otheraccountname: 100,
    destinationaccount: 95,
    destinationaccountname: 95,
    toaccount: 95,
    transferaccount: 90,
    counteraccount: 85,
  },
}

const HEADER_CONTAINS_SCORES: Record<ColumnTarget, Array<{ value: string; score: number }>> = {
  account_id: [
    { value: 'account name', score: 85 },
    { value: 'source account', score: 85 },
    { value: 'account', score: 60 },
  ],
  dt: [
    { value: 'transaction date', score: 90 },
    { value: 'posting date', score: 85 },
    { value: 'posted date', score: 85 },
    { value: 'date', score: 65 },
  ],
  category_id: [
    { value: 'category', score: 80 },
  ],
  amount: [
    { value: 'transaction amount', score: 90 },
    { value: 'signed amount', score: 90 },
    { value: 'amount', score: 70 },
  ],
  currency: [
    { value: 'currency code', score: 90 },
    { value: 'currency', score: 75 },
  ],
  merchant_id: [
    { value: 'merchant', score: 85 },
    { value: 'payee', score: 85 },
    { value: 'vendor', score: 80 },
    { value: 'description', score: 55 },
  ],
  notes: [
    { value: 'notes', score: 85 },
    { value: 'memo', score: 80 },
    { value: 'comment', score: 75 },
    { value: 'reference', score: 70 },
    { value: 'detail', score: 65 },
    { value: 'description', score: 40 },
  ],
  tag_ids: [
    { value: 'tags', score: 85 },
    { value: 'labels', score: 80 },
  ],
  counterparty_account_id: [
    { value: 'counterparty account', score: 90 },
    { value: 'other account', score: 90 },
    { value: 'destination account', score: 85 },
    { value: 'transfer account', score: 80 },
    { value: 'counter account', score: 80 },
  ],
}

// Targets are matched in order and each header can only be claimed once, so the account column is
// barred from the headers describing the counterparty account of a transfer, which it would
// otherwise take first. A file whose own account column is called "Destination account" is mapped
// by hand
const EXCLUDED_HEADER_PARTS: Partial<Record<ColumnTarget, string[]>> = {
  account_id: ['number', 'no', 'iban', 'routing', 'other', 'destination', 'counter'],
  amount: ['balance', 'available', 'limit', 'rate'],
}

// How long an excluded part has to be before it is also looked for inside a run-together heading.
// A heading written without separators has no words to check, so `accountnumber` would otherwise
// escape the list that blocks `Account Number`. Only the longer parts are safe to look for this way,
// because a short one appears inside ordinary words: `no` sits inside `nominee`
const MIN_COMPACT_EXCLUSION_LENGTH = 5

// How many distinct values a column needs before repetition alone reads it as a category. Two or
// three distinct words is a flag column, which is what let a Type column of Debit and Credit take
// the category field, while a real category column names more things than that
const MIN_CATEGORY_DISTINCT_VALUES = 4

/**
 * Infers which app field each unmapped column corresponds to, scoring both the header text and a
 * sample of its values against known patterns for each target field, then validates the resulting
 * map against the uploaded files
 *
 * A column already mapped, explicitly or from a previous inference, is left alone, and each column
 * can only be claimed by the single best-scoring target so two fields never end up pointing at the
 * same header
 *
 * @param decidedHeaders - Columns the user has answered for, including the ones they set to Do not
 * import. These are left exactly as they are, so replacing the file with one carrying the same
 * headings does not undo the answer. The decision is remembered about the column rather than about
 * the field, so ignoring a column keeps it ignored while a different column can still fill the field
 * it used to hold
 */
export function inferColumnMap(
  columnMap: ColumnMap,
  files: ImportFileDraft[],
  supportedCurrencyCodes: Set<string>,
  decidedHeaders: Set<string> = new Set(),
) {
  const result = validateColumnMap(columnMap, files, supportedCurrencyCodes)
  if (files.length === 0) return result

  const headers = unique(files.flatMap((file) => file.headers))
  const inferredMap = { ...result.map }

  const usedHeaders = new Set([...Object.values(inferredMap).filter(Boolean), ...decidedHeaders])

  // What a heading says beats what the values look like, whichever field asks first. Taking every
  // heading match before any value match is what stops a column of short text being claimed as a
  // merchant on its shape while the field its heading actually names is still waiting for it
  for (const byHeadingOnly of [true, false]) {
    for (const target of COLUMN_TARGETS) {
      if (inferredMap[target.id]) continue

      const header = getBestHeaderMatch(files, headers, usedHeaders, target.id, supportedCurrencyCodes, byHeadingOnly)
      if (!header) continue

      inferredMap[target.id] = header
      usedHeaders.add(header)
    }
  }

  return validateColumnMap(inferredMap, files, supportedCurrencyCodes)
}

/**
 * Picks the column a field should take, or an empty string where none is good enough
 *
 * @param byHeadingOnly - Whether to judge on the heading alone, ignoring what the values look like
 */
function getBestHeaderMatch(
  files: ImportFileDraft[],
  headers: string[],
  usedHeaders: Set<string>,
  target: ColumnTarget,
  supportedCurrencyCodes: Set<string>,
  byHeadingOnly = false,
) {
  let bestMatch: { header: string; score: number } | null = null

  for (const header of headers) {
    if (usedHeaders.has(header)) continue

    // A header the target is not allowed to take is skipped outright, since what its values look
    // like would otherwise claim it anyway
    if (isHeaderExcludedForTarget(header, target)) continue

    const headerScore = scoreHeaderForTarget(header, target)
    const score = byHeadingOnly
      ? headerScore
      : Math.max(headerScore, scoreValuesForTarget(files, header, target, supportedCurrencyCodes))
    if (score <= 0) continue

    const validation = validateColumnValues(files, header, target, supportedCurrencyCodes)
    if (!validation.valid) continue

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { header, score }
    }
  }

  return bestMatch?.header ?? ''
}

function isHeaderExcludedForTarget(header: string, target: ColumnTarget) {
  const normalized = normalizeHeader(header)
  const parts = normalized.split(' ')
  const compact = normalized.replace(/\s/g, '')

  return (EXCLUDED_HEADER_PARTS[target] ?? []).some((excluded) => (
    parts.includes(excluded)
    || (excluded.length >= MIN_COMPACT_EXCLUSION_LENGTH && compact.includes(excluded))
  ))
}

function scoreHeaderForTarget(header: string, target: ColumnTarget) {
  const normalized = normalizeHeader(header)
  if (!normalized) return 0

  const compact = normalized.replace(/\s/g, '')

  // Asked of the table's own keys rather than by reading the property, because a column named
  // constructor would otherwise return the function every object inherits, which is truthy and
  // turns the comparison against it into a value nothing can beat
  const aliases = HEADER_ALIAS_SCORES[target]
  const aliasScore = Object.hasOwn(aliases, compact) ? aliases[compact] : 0
  if (aliasScore) return aliasScore

  const containsScore = HEADER_CONTAINS_SCORES[target].find((match) => normalized.includes(match.value))?.score
  return containsScore ?? 0
}

function scoreValuesForTarget(
  files: ImportFileDraft[],
  header: string,
  target: ColumnTarget,
  supportedCurrencyCodes: Set<string>,
) {
  const values = getColumnValues(files, header).filter(Boolean)
  if (values.length === 0) return 0

  const validDateRatio = getRatio(values, isValidDateValue)
  const validAmountRatio = getRatio(values, isValidAmountValue)
  const validCurrencyRatio = getRatio(values, (value) => isSupportedCurrency(value, supportedCurrencyCodes))
  const textValues = values.filter((value) => isPlainTextData(value, supportedCurrencyCodes))
  const textRatio = textValues.length / values.length
  const uniqueRatio = unique(textValues.map(normalizeValue)).length / Math.max(textValues.length, 1)
  const dominantRatio = getDominantRatio(textValues)
  const averageTextLength = getAverageLength(textValues)

  if (target === 'dt') return validDateRatio >= 0.8 ? Math.round(validDateRatio * 95) : 0
  if (target === 'amount') return validAmountRatio >= 0.8 ? Math.round(validAmountRatio * 95) : 0
  if (target === 'currency') return validCurrencyRatio >= 0.8 ? Math.round(validCurrencyRatio * 85) : 0
  if (target === 'account_id') {
    const accountLikeRatio = getRatio(textValues, isAccountLikeValue)
    return textRatio >= 0.8 && dominantRatio >= 0.8 && accountLikeRatio > 0 ? 48 : 0
  }
  if (target === 'category_id') {
    if (textRatio < 0.8 || averageTextLength > 42) return 0
    if (getRatio(textValues, isCategoryLikeValue) >= 0.4) return 58

    // Repetition on its own only reads as a category once the column names enough different things
    const distinctCount = unique(textValues.map(normalizeValue)).length
    if (distinctCount < MIN_CATEGORY_DISTINCT_VALUES) return 0

    return uniqueRatio <= 0.35 && dominantRatio < 0.75 ? 40 : 0
  }
  if (target === 'merchant_id') {
    return textRatio >= 0.8 && averageTextLength <= 52 && uniqueRatio > 0.35 ? 38 : 0
  }
  if (target === 'notes') {
    return textRatio >= 0.8 && averageTextLength > 35 ? 30 : 0
  }
  if (target === 'tag_ids') {
    return getRatio(textValues, (value) => /[,;|]/.test(value)) >= 0.4 ? 42 : 0
  }

  return 0
}

function getColumnValues(files: ImportFileDraft[], header: string) {
  return files.flatMap((file) => {
    if (!file.headers.includes(header)) return []
    return file.rows.map((row) => row[header]?.trim() ?? '')
  })
}

function getRatio(values: string[], predicate: (value: string) => boolean) {
  return values.length === 0 ? 0 : values.filter(predicate).length / values.length
}

function getDominantRatio(values: string[]) {
  if (values.length === 0) return 0

  const counts = new Map<string, number>()
  for (const value of values) {
    const normalized = normalizeValue(value)
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }

  return Math.max(...counts.values()) / values.length
}

function getAverageLength(values: string[]) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value.length, 0) / values.length
}

function isPlainTextData(value: string, supportedCurrencyCodes: Set<string>) {
  return Boolean(value.trim())
    && !isValidDateValue(value)
    && !isValidAmountValue(value)
    && !isSupportedCurrency(value, supportedCurrencyCodes)
}

function isAccountLikeValue(value: string) {
  return /\b(amex|bank|card|cash|checking|chequing|credit|heloc|line of credit|loc|loan|mastercard|mortgage|savings|visa)\b/i.test(value)
}

function isCategoryLikeValue(value: string) {
  return /\b(automotive|bill|bills|clothing|coffee|dining|education|entertainment|fee|fees|food|fuel|garden|groceries|grocery|health|home|household|income|insurance|interest|medical|payment|payroll|pet|pets|rent|restaurant|restaurants|salary|shopping|subscription|subscriptions|transfer|transport|travel|utilities)\b/i.test(value)
}

function normalizeValue(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Reduces a heading to lower-case words separated by single spaces
 *
 * A name written in camel case is split first, so `AccountNumber` reads as the two words
 * `Account Number` already does and the checks that work on words see both of them. Squeezing the
 * spaces back out afterwards gives the same key either spelling, so the alias table is unaffected
 */
function normalizeHeader(header: string) {
  return header
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
