import { COLUMN_TARGETS } from '@/pages/imports/constants'
import type { ColumnMap, ColumnTarget, ImportAmountSideTarget, ImportFileDraft } from '@/pages/imports/types'
import { unique } from './common'
import { getImportDirectionValues, validateColumnMap, validateColumnValues } from './columnMapping'
import { guessImportDirectionAnswers, isSupportedCurrency, isValidAmountValue, isValidDateValue } from './valueParsers'

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
  // The past-tense and plain-English wordings are listed alongside the bookkeeping ones because the
  // two sides have to match together. A pair where only one side is recognised is worse than one
  // where neither is: the unmatched column falls to another field and its rows import the wrong way
  amount_out: {
    debit: 100,
    debits: 100,
    debitamount: 100,
    withdrawal: 100,
    withdrawals: 100,
    withdrawn: 100,
    moneyout: 100,
    paidout: 100,
    outflow: 90,
    outgoing: 90,
    out: 70,
  },
  amount_in: {
    credit: 100,
    credits: 100,
    creditamount: 100,
    deposit: 100,
    deposits: 100,
    deposited: 100,
    moneyin: 100,
    paidin: 100,
    inflow: 90,
    incoming: 90,
    in: 70,
  },

  // What a column of words carrying the direction is called. The money fields leave every one
  // of these alone, for two different reasons: a heading naming both directions at once is one each
  // of them is barred from, since each is barred from any heading another recognises, and a heading
  // like Type or Direction is simply absent from all three of their tables
  amount_direction: {
    type: 90,
    transactiontype: 100,
    drcr: 100,
    crdr: 100,
    debitcredit: 100,
    creditdebit: 100,
    debitorcredit: 100,
    debitcreditindicator: 100,
    direction: 100,
    transactionindicator: 90,
    indicator: 80,
    dc: 70,
    cd: 70,
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
  // Every wording the alias table above knows appears here too. An alias only matches a heading that
  // is nothing but that word, so without the pair a compound like "Outgoing Amount" is recognised by
  // neither table, and the single Amount field then takes it on the word it ends with
  amount_out: [
    { value: 'money out', score: 90 },
    { value: 'amount out', score: 90 },
    { value: 'paid out', score: 90 },
    { value: 'outgoing', score: 90 },
    { value: 'outflow', score: 90 },
    { value: 'debit', score: 85 },
    { value: 'withdraw', score: 85 },
  ],
  amount_in: [
    { value: 'money in', score: 90 },
    { value: 'amount in', score: 90 },
    { value: 'paid in', score: 90 },
    { value: 'incoming', score: 90 },
    { value: 'inflow', score: 90 },
    { value: 'credit', score: 85 },
    { value: 'deposit', score: 85 },
  ],
  amount_direction: [
    { value: 'transaction type', score: 95 },
    { value: 'debit credit', score: 95 },
    { value: 'credit debit', score: 95 },
    { value: 'dr cr', score: 95 },
    { value: 'cr dr', score: 95 },
    { value: 'direction', score: 90 },
    { value: 'indicator', score: 80 },
    { value: 'type', score: 60 },
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
// A running total, a headroom figure and an identifier are all barred from every amount field: the
// first two are money by shape, and an identifier is a run of digits the side fields would otherwise
// take, since they accept any number and any blank
const AMOUNT_LIKE_EXCLUDED_PARTS = ['balance', 'available', 'limit', 'rate', 'number', 'iban', 'routing']

const EXCLUDED_HEADER_PARTS: Partial<Record<ColumnTarget, string[]>> = {
  account_id: ['number', 'no', 'iban', 'routing', 'other', 'destination', 'counter'],
  amount: AMOUNT_LIKE_EXCLUDED_PARTS,
  amount_out: AMOUNT_LIKE_EXCLUDED_PARTS,
  amount_in: AMOUNT_LIKE_EXCLUDED_PARTS,
}

// Which other amount fields a heading has to be unknown to before this one may take it. The single
// Amount field is barred from any heading either side recognises, because such a heading states one
// direction and reading it as the whole transaction signs half the file wrongly. Each side is barred
// from the other's headings, which is what leaves a lone column called "Debit/Credit Amount" to be
// answered by hand: stating both directions, it is claimable by neither side, and the Direction
// field cannot take it either because a column of money holds far more values than a direction has
//
// Asked of the scoring tables rather than repeated as its own word list, since a list would have to
// be extended every time a wording was added to those tables and is wrong in the meantime
//
// The Direction field is deliberately absent from this table. Its own headings name both directions,
// so barring it from anything either side recognises would bar it from every heading it exists for.
// What keeps it off a column of money is the shape check instead
const RIVAL_AMOUNT_TARGETS: Partial<Record<ColumnTarget, ColumnTarget[]>> = {
  amount: ['amount_out', 'amount_in'],
  amount_out: ['amount_in'],
  amount_in: ['amount_out'],
}

// Only ever guessed together, since one side on its own says nothing about how the file writes its
// amounts
const AMOUNT_SIDE_TARGETS: ImportAmountSideTarget[] = ['amount_out', 'amount_in']

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
 * @param omitAccountColumn - Whether the finished map may hold an account column, which an import
 * started from an account may not, since that account is the answer. The account column is still
 * detected and only dropped at the end, so a column it claims is not left for another field to take.
 * Skipping the detection instead would hand a column of account names to the merchant field, which
 * scores on the shape of a short repeated text column. This only covers a column the account field
 * would accept: one with a blank cell fails its required-values check, is refused there, and can
 * still be claimed as a merchant, which is what happens on an ordinary import as well
 */
export function inferColumnMap(
  columnMap: ColumnMap,
  files: ImportFileDraft[],
  supportedCurrencyCodes: Set<string>,
  decidedHeaders: Set<string> = new Set(),
  { omitAccountColumn = false } = {},
) {
  const result = validateColumnMap(columnMap, files, supportedCurrencyCodes)
  if (files.length === 0) return result

  const headers = unique(files.flatMap((file) => file.headers))
  const inferredMap = { ...result.map }

  const usedHeaders = new Set([...Object.values(inferredMap).filter(Boolean), ...decidedHeaders])

  // Both sides or neither. One side matching a heading says nothing about how the file writes its
  // amounts, since a lone Deposit column sits just as happily beside one signed column, and no
  // heading tells those two apart. Guessing half the arrangement is the worst of the three outcomes,
  // because the unmatched column is then read as the whole transaction, so a file the guesser cannot
  // settle is left for the user to answer against the samples the mapping table shows them
  const sideHeaders = AMOUNT_SIDE_TARGETS.map(
    (target) => getBestHeaderMatch(files, headers, usedHeaders, target, supportedCurrencyCodes, true),
  )
  const areSidesInferable = sideHeaders.every(Boolean)

  // What a heading says beats what the values look like, whichever field asks first. Taking every
  // heading match before any value match is what stops a column of short text being claimed as a
  // merchant on its shape while the field its heading actually names is still waiting for it
  for (const byHeadingOnly of [true, false]) {
    for (const target of COLUMN_TARGETS) {
      if (inferredMap[target.id]) continue

      // The three amount fields are alternatives, so once one arrangement is settled the other is
      // not asked. A file stating its whole transaction in one column has no sides to read, and one
      // stating both has no separate total: whatever numeric column is left over there is a fee or a
      // running balance
      const isSide = AMOUNT_SIDE_TARGETS.includes(target.id as ImportAmountSideTarget)
      if (isSide && (!areSidesInferable || inferredMap.amount)) continue
      if (target.id === 'amount' && AMOUNT_SIDE_TARGETS.every((side) => inferredMap[side])) continue

      // A file writing its two directions in separate columns carries the direction already, so
      // nothing is left for a Direction column to add. The sides are declared above this field and so
      // have already had their turn by the time it is asked
      if (target.id === 'amount_direction' && AMOUNT_SIDE_TARGETS.some((side) => inferredMap[side])) continue

      const header = getBestHeaderMatch(files, headers, usedHeaders, target.id, supportedCurrencyCodes, byHeadingOnly)
      if (!header) continue
      if (target.id === 'amount_direction' && !isDirectionColumnReadable(files, header)) continue

      inferredMap[target.id] = header
      usedHeaders.add(header)
    }
  }

  if (omitAccountColumn) inferredMap.account_id = ''

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

/**
 * Reports whether a column's own words settle the direction of each of its rows
 *
 * The heading alone is not enough to claim this field. A column of two values headed Type is as
 * likely to hold `Personal` and `Business` as it is `DEBIT` and `CREDIT`, and claiming the first
 * would block the commit on a question about a column that imports cleanly today. Where the words do
 * settle it the answers arrive filled in as well, so a DEBIT and CREDIT file needs no clicks
 */
function isDirectionColumnReadable(files: ImportFileDraft[], header: string) {
  const values = getImportDirectionValues(files, header).map((value) => value.label)
  return values.length > 0 && Object.keys(guessImportDirectionAnswers(values)).length > 0
}

function isHeaderExcludedForTarget(header: string, target: ColumnTarget) {
  const normalized = normalizeHeader(header)
  const parts = normalized.split(' ')
  const compact = normalized.replace(/\s/g, '')

  const isExcludedByPart = (EXCLUDED_HEADER_PARTS[target] ?? []).some((excluded) => (
    parts.includes(excluded)
    || (excluded.length >= MIN_COMPACT_EXCLUSION_LENGTH && compact.includes(excluded))
  ))

  return isExcludedByPart
    || (RIVAL_AMOUNT_TARGETS[target] ?? []).some((rival) => scoreHeaderForTarget(header, rival) > 0)
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

  // Neither side of a two-sided file is ever claimed on its values. A column of money out looks
  // exactly like any other column of money, so scoring these on shape would pair off whichever two
  // numeric columns a file happens to hold. The arrangement is claimed from the headings or answered
  // by hand
  if (target === 'amount_out' || target === 'amount_in') return 0
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
