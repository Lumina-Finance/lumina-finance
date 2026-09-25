import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type {
  FireflyBudgetImportLimit,
  FireflyBudgetImportRecurrence,
  FireflyImportRunBudgets,
} from '@/api/firefly-imports'
import type { TransactionImportCategoryMapping } from '@/api/transaction-imports'
import type { CsvRow, ImportFileDraft } from '@/pages/imports/types'
import {
  FIREFLY_BUDGET_ACTIVE_VALUE,
  FIREFLY_BUDGET_MAX_CATEGORIES,
  FIREFLY_BUDGET_MAX_INSTANCE_LENGTH,
  FIREFLY_BUDGET_MAX_LIMIT_PERIODS,
  FIREFLY_BUDGET_MIXED_CURRENCIES_REASON,
  FIREFLY_BUDGET_NAME_MAX_LENGTH,
  FIREFLY_BUDGET_NO_CATEGORIES_REASON,
  FIREFLY_BUDGET_NO_LIMITS_REASON,
  FIREFLY_BUDGET_NO_TRANSACTIONS_REASON,
  FIREFLY_BUDGET_OVERLAPPING_PERIODS_REASON,
  FIREFLY_BUDGET_PERIOD_ENDS_BEFORE_START_REASON,
  FIREFLY_BUDGET_UNREADABLE_DATES_REASON,
  FIREFLY_BUDGET_UNSUPPORTED_CADENCE_REASON,
  FIREFLY_ROW_FIELD_MAX_LENGTHS,
  FIREFLY_TYPE_WITHDRAWAL,
  getFireflyBudgetAmountReason,
  getFireflyBudgetGroupCategoryReason,
  getFireflyBudgetOverLimitReason,
  getFireflyBudgetUnsupportedCurrencyReason,
} from '@/pages/imports/firefly/constants'
import type { FireflyBudgetDraft } from '@/pages/imports/firefly/types'
import { toImportMinorUnits } from '@/pages/imports/utils/valueParsers'
import { parseYmd } from '@/utils/date'
import { formatCurrency } from '@/utils/formatCurrency'
import { FIREFLY_NO_CATEGORY_SOURCE } from '@/api/firefly-imports'
import { CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
import { findReusedImportCategory, getCategoryNameKey } from '@/pages/imports/utils/categoryMatching'
import {
  countCharacters,
  getFireflySplitGroupSizes,
  isFireflyCategoryUseRow,
  isFireflyRowUploadable,
  toFireflyUnsignedAmount,
} from './derivation'
import { resolveFireflyRowLegs, type FireflyRowResolutionOptions } from './rowResolution'

const DAYS_PER_WEEK = 7
const MONTHS_PER_YEAR = 12

// Highest configurable day-of-month anchor, which a period starting on the
// last day of a short month could be the capped form of
const MAX_MONTH_ANCHOR_DAY = 31

/**
 * How transactions in the export reference one budget name
 */
interface FireflyBudgetUsage {
  categoryNames: Set<string>
}

/**
 * One budgets-export row reduced to the fields a limit schedule needs
 */
interface FireflyLimitRow {
  start: string
  end: string
  amount: string
  currencyCode: string
}

/**
 * One budget name's rows from the export, with the archived flag read off them
 *
 * Firefly III repeats the flag on every limit period of a budget because the
 * export is one row per period, so it is read once per name
 */
interface FireflyBudgetRows {
  isArchived: boolean
  limitRows: FireflyLimitRow[]
}

/**
 * What a budget draft is checked against besides its own export rows
 */
interface FireflyBudgetDraftContext {
  /**
   * Currencies Lumina Finance supports, which have loaded before any file can be staged
   */
  currencies: Currency[]

  /**
   * Category mapping chosen for each export category name, a category ID or the create value
   */
  categoryMappings: Record<string, string>
  categoryById: Map<string, Category>
}

/**
 * Derives importable budget drafts from the budgets export and the staged
 * transaction rows
 *
 * Drafts derive before the commit so the budget preview can drive what the
 * commit imports. Each names its categories by their export name, which the
 * import run maps along with the rest of the import. A budget the backend would
 * refuse is skipped with its reason, since the import is all or nothing
 */
export function buildFireflyBudgetDrafts({
  budgetsFile,
  transactionRows,
  ...context
}: FireflyBudgetDraftContext & {
  budgetsFile: ImportFileDraft | null
  transactionRows: CsvRow[]
}): FireflyBudgetDraft[] {
  if (!budgetsFile || budgetsFile.error) return []

  // The budgets export repeats one row per limit period, so every row of a
  // name contributes to that budget's limit schedule
  const rowsByName = new Map<string, FireflyBudgetRows>()
  for (const row of budgetsFile.rows) {
    const name = row.name?.trim()
    if (!name) continue

    const budget = rowsByName.get(name)
      ?? { isArchived: row.active?.trim() !== FIREFLY_BUDGET_ACTIVE_VALUE, limitRows: [] }
    budget.limitRows.push({
      start: row.start_date?.trim() ?? '',
      end: row.end_date?.trim() ?? '',
      amount: row.amount?.trim() ?? '',
      currencyCode: row.currency_code?.trim().toUpperCase() ?? '',
    })
    rowsByName.set(name, budget)
  }

  const usageByName = new Map<string, FireflyBudgetUsage>()
  const groupSizes = getFireflySplitGroupSizes(transactionRows)
  for (const row of transactionRows) {
    const budgetName = row.budget?.trim()
    if (!budgetName) continue

    // Rows left out whatever the mappings never write a category, so they
    // cannot vote on a budget's tracked categories
    if (!isFireflyRowUploadable(row, groupSizes)) continue

    const usage = usageByName.get(budgetName) ?? { categoryNames: new Set<string>() }

    // Only a row written with its category is counted in that category, so a transfer or balance
    // row carrying the budget adds none, and a budget with only those tracks nothing
    const category = row.category?.trim()
    if (category && isFireflyCategoryUseRow(row, groupSizes)) usage.categoryNames.add(category)
    usageByName.set(budgetName, usage)
  }

  // Firefly III writes one budgets row per limit, so a budget without limits is missing from the
  // file entirely, and it is listed with no limit rows rather than vanishing without a reason
  for (const name of usageByName.keys()) {
    if (!rowsByName.has(name)) rowsByName.set(name, { isArchived: false, limitRows: [] })
  }

  const drafts: FireflyBudgetDraft[] = []
  for (const [name, budget] of rowsByName) {
    drafts.push(buildBudgetDraft(name, budget, usageByName.get(name), context))
  }

  return drafts.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Turns budget drafts into what the run creates alongside the export's rows
 *
 * A budget names its categories by the export category names the category step mapped, and
 * carries the mapping of each, since a budget can track a category none of the uploaded rows uses
 *
 * @param drafts - The budgets to import
 * @param categoryMappings - Every category mapping the import built
 * @throws When a budget names a category the import has no mapping for, which the commit would
 *   refuse, so it is caught before anything is uploaded
 */
export function buildFireflyRunBudgets(
  drafts: FireflyBudgetDraft[],
  categoryMappings: TransactionImportCategoryMapping[],
): FireflyImportRunBudgets {
  const mappingsBySource = new Map(categoryMappings.map((mapping) => [mapping.source, mapping]))
  const usedMappings = new Map<string, TransactionImportCategoryMapping>()

  const budgets = drafts.map((draft) => {
    const categorySources = [...new Set(draft.categoryNames)]
    for (const source of categorySources) {
      const mapping = mappingsBySource.get(source)
      if (!mapping) throw new Error(`${draft.name}: category ${source} is not mapped`)
      usedMappings.set(source, mapping)
    }

    return {
      name: draft.name,
      currency: draft.currencyCode,
      category_sources: categorySources,
      // Only a limit above zero is importable, so this drops no more than a plus sign
      limits: draft.limits.map((limit) => ({ ...limit, amount: toFireflyUnsignedAmount(limit.amount) })),
      recurrence: draft.recurrence,
      is_archived: draft.isArchived,
    }
  })

  return { categories: [...usedMappings.values()], budgets }
}

/**
 * The Lumina category an export category name becomes, keyed so that names merging into one
 * category share a key
 */
interface FireflyCategoryTarget {
  key: string
  name: string
}

/**
 * Returns the Lumina category an export category name is matched to, or null when it has no match
 *
 * A new category whose name an existing one already holds reuses it, and two new names differing
 * only in capitals become one, so both count as the same category here
 */
function getFireflyCategoryTarget(source: string, options: FireflyRowResolutionOptions): FireflyCategoryTarget | null {
  const mapping = options.categoryMappings[source]
  if (!mapping) return null
  if (mapping !== CREATE_CATEGORY_VALUE) {
    return { key: mapping, name: options.categoryById.get(mapping)?.name ?? source }
  }

  const reused = findReusedImportCategory(source, options.categoryById.values())
  return reused ? { key: reused.id, name: reused.name } : { key: `new:${getCategoryNameKey(source)}`, name: source }
}

/**
 * Writes one line for each way a selected budget will count spending differently from Firefly III
 *
 * A Lumina budget counts whole categories, so a budget sharing a category with another selected
 * budget counts the other's spending there too, and a budget's spending with no category is never
 * counted against it unless rows with no category are matched to a category the budget tracks.
 * Both are read after the user's category matching, and the spending from the legs the preview
 * predicts, so a skipped row or one written in another currency is counted as it will import
 */
export function buildFireflyBudgetCountingNotes({
  drafts,
  selectedNames,
  rows,
  options,
}: {
  drafts: FireflyBudgetDraft[]
  selectedNames: Set<string>
  rows: CsvRow[]
  options: FireflyRowResolutionOptions
}): string[] {
  const selected = drafts.filter((draft) => !draft.disabledReason && selectedNames.has(draft.name))
  const targetsByBudget = new Map(selected.map((draft) => {
    const targets = new Map<string, string>()
    for (const categoryName of draft.categoryNames) {
      const target = getFireflyCategoryTarget(categoryName, options)
      if (target) targets.set(target.key, target.name)
    }
    return [draft.name, targets]
  }))

  const budgetNamesByTarget = new Map<string, string[]>()
  for (const [budgetName, targets] of targetsByBudget) {
    for (const key of targets.keys()) budgetNamesByTarget.set(key, [...budgetNamesByTarget.get(key) ?? [], budgetName])
  }

  const uncategorizedTarget = getFireflyCategoryTarget(FIREFLY_NO_CATEGORY_SOURCE, options)
  const uncategorizedByBudget = new Map<string, Map<string, number>>()
  const groupSizes = getFireflySplitGroupSizes(rows)
  for (const row of rows) {
    const budgetName = row.budget?.trim() ?? ''
    const targets = targetsByBudget.get(budgetName)
    if (!targets || row.category?.trim() || !isFireflyCategoryUseRow(row, groupSizes)) continue
    if (row.type?.trim().toLowerCase() !== FIREFLY_TYPE_WITHDRAWAL) continue

    // Rows with no category matched to a category the budget tracks are counted after all
    if (uncategorizedTarget && targets.has(uncategorizedTarget.key)) continue

    const { legs } = resolveFireflyRowLegs(row, options)
    for (const leg of legs ?? []) {
      const totals = uncategorizedByBudget.get(budgetName) ?? new Map<string, number>()
      totals.set(leg.account.currency, (totals.get(leg.account.currency) ?? 0) + Math.abs(leg.amount))
      uncategorizedByBudget.set(budgetName, totals)
    }
  }

  return selected.flatMap((draft) => {
    const notes: string[] = []
    for (const [key, categoryName] of targetsByBudget.get(draft.name) ?? []) {
      const others = (budgetNamesByTarget.get(key) ?? []).filter((name) => name !== draft.name)
      if (others.length === 0) continue
      const theirs = others.length === 1 ? `${others[0]}'s` : 'their'
      notes.push(`${draft.name} shares ${categoryName} with ${joinNames(others)}, so it also counts ${theirs} spending in ${categoryName}.`)
    }

    const totals = [...uncategorizedByBudget.get(draft.name) ?? []]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currencyCode, minorUnits]) => formatCurrency(minorUnits, currencyCode, options.currencies))
    if (totals.length > 0) {
      notes.push(`${draft.name} has ${joinNames(totals)} of spending with no category in Firefly III, which it will not count.`)
    }
    return notes
  })
}

/**
 * Joins names into a readable list, such as "A, B and C"
 */
function joinNames(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? ''
}

/**
 * Writes an amount in its currency's own format, or as exported beside its code when it cannot be
 * read in that currency
 */
function formatBudgetAmount(amount: string, currencyCode: string, currencies: Currency[]): string {
  const currency = currencies.find((entry) => entry.id.toUpperCase() === currencyCode)
  if (currency) {
    const minorUnits = toImportMinorUnits(amount, currency.minor_unit_exponent)
    if (typeof minorUnits === 'bigint') return formatCurrency(Number(minorUnits), currency.id, currencies)
  }
  return `${amount} ${currencyCode}`.trim()
}

/**
 * One deduplicated limit period, with its dates read into time values so the
 * schedule can be ordered without comparing the strings
 */
interface FireflyLimitEntry {
  limit: FireflyBudgetImportLimit
  currencyCode: string
  startTime: number
  endTime: number
}

/**
 * Builds the sorted limit period schedule for one budget from its export rows
 *
 * Rows missing a date, amount, or currency cannot place a period in the
 * schedule and are dropped, and exact duplicate rows collapse to one entry
 * while conflicting rows over the same days are reported as overlapping
 *
 * The latest period's currency comes back alongside the schedule because it is
 * the one the drafts table displays, and ordering the rows a second time to
 * find it would order rows this pass has already refused
 */
function buildLimitSchedule(limitRows: FireflyLimitRow[]): {
  limits: FireflyBudgetImportLimit[]
  currencyCodes: string[]
  latestCurrencyCode: string
  hasUnreadableDates: boolean
  hasEndBeforeStart: boolean
  hasOverlap: boolean
} {
  const seen = new Set<string>()
  const entries: FireflyLimitEntry[] = []
  const currencyCodes = new Set<string>()
  let hasUnreadableDates = false

  // The currency is recorded before deduplication and is part of the
  // duplicate key, because Firefly III can hold one limit per currency over
  // the same window and collapsing those would silently drop a currency
  // instead of skipping the budget as mixed
  for (const row of limitRows) {
    if (!row.start || !row.end || !row.amount || !row.currencyCode) continue

    // A present value that is not a real date marks the file as corrupted, so
    // the budget is refused loudly rather than the row quietly vanishing or
    // the backend failing the whole import
    const start = parseYmd(row.start)
    const end = parseYmd(row.end)
    if (!start || !end) {
      hasUnreadableDates = true
      continue
    }

    currencyCodes.add(row.currencyCode)
    const key = `${row.start} ${row.end} ${row.amount} ${row.currencyCode}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({
      limit: { start: row.start, end: row.end, amount: row.amount },
      currencyCode: row.currencyCode,
      startTime: start.getTime(),
      endTime: end.getTime(),
    })
  }

  entries.sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime)

  // The backend's rule: once sorted by start, a period starting on or before the previous one's
  // end shares a day with it
  const hasOverlap = entries.some((entry, index) => index > 0 && entry.startTime <= entries[index - 1].endTime)

  return {
    limits: entries.map((entry) => entry.limit),
    currencyCodes: [...currencyCodes].sort(),
    latestCurrencyCode: entries[entries.length - 1]?.currencyCode ?? '',
    hasUnreadableDates,
    hasEndBeforeStart: entries.some((entry) => entry.endTime < entry.startTime),
    hasOverlap,
  }
}

/**
 * Resolves one budget name into a draft, disabling it when the export cannot
 * back a Lumina budget or the backend would refuse it
 */
function buildBudgetDraft(
  name: string,
  budget: FireflyBudgetRows,
  usage: FireflyBudgetUsage | undefined,
  context: FireflyBudgetDraftContext,
): FireflyBudgetDraft {
  const categoryNames = [...usage?.categoryNames ?? []].sort((a, b) => a.localeCompare(b))
  const schedule = buildLimitSchedule(budget.limitRows)
  const { limits, currencyCodes, latestCurrencyCode } = schedule

  // The most recent period decides the amount, currency and cadence the drafts table displays,
  // while the full schedule travels to the backend
  const latest = limits.length > 0 ? limits[limits.length - 1] : null
  const recurrence = latest ? getFireflyBudgetRecurrence(latest) : null
  const repeatsUnsupported = repeatsOnUnsupportedCadence(limits)

  const disabledReason = !usage
    ? FIREFLY_BUDGET_NO_TRANSACTIONS_REASON
    : schedule.hasUnreadableDates
      ? FIREFLY_BUDGET_UNREADABLE_DATES_REASON
      : !latest
        ? FIREFLY_BUDGET_NO_LIMITS_REASON
        : categoryNames.length === 0
          ? FIREFLY_BUDGET_NO_CATEGORIES_REASON
          : getRefusalReason(name, categoryNames, schedule, context)
            ?? (repeatsUnsupported ? FIREFLY_BUDGET_UNSUPPORTED_CADENCE_REASON : null)

  return {
    name,
    amount: latest ? formatBudgetAmount(latest.amount, latestCurrencyCode, context.currencies) : '',
    currencyCode: latestCurrencyCode,
    currencyCodes,
    isArchived: budget.isArchived,
    limits,
    firstPeriodStart: limits.length > 0 ? limits[0].start : null,
    lastPeriodEnd: latest?.end ?? null,
    recurrence,
    periodLabel: latest ? describeCadence(latest, recurrence, repeatsUnsupported) : null,
    categoryNames,
    disabledReason,
  }
}

/**
 * Returns why the backend would refuse a budget whose schedule is otherwise complete, or null
 *
 * The import is all or nothing, so each of these would fail the whole import
 */
function getRefusalReason(
  name: string,
  categoryNames: string[],
  schedule: ReturnType<typeof buildLimitSchedule>,
  { currencies, categoryMappings, categoryById }: FireflyBudgetDraftContext,
): string | null {
  const groupCategory = categoryNames.find((categoryName) => (
    categoryById.get(categoryMappings[categoryName] ?? '')?.group_id
  ))
  if (groupCategory) return getFireflyBudgetGroupCategoryReason(groupCategory)

  // Every check below reads the budget's one currency
  if (schedule.currencyCodes.length > 1) return FIREFLY_BUDGET_MIXED_CURRENCIES_REASON

  const currencyCode = schedule.latestCurrencyCode
  const currency = currencies.find((entry) => entry.id.toUpperCase() === currencyCode)
  if (!currency) return getFireflyBudgetUnsupportedCurrencyReason(currencyCode)

  for (const limit of schedule.limits) {
    const problem = getLimitAmountProblem(limit.amount, currency.minor_unit_exponent)
    if (problem) return getFireflyBudgetAmountReason(limit.amount, currencyCode, problem)
  }

  if (schedule.hasEndBeforeStart) return FIREFLY_BUDGET_PERIOD_ENDS_BEFORE_START_REASON
  if (schedule.hasOverlap) return FIREFLY_BUDGET_OVERLAPPING_PERIODS_REASON

  const nameLength = countCharacters(name)
  if (nameLength > FIREFLY_BUDGET_NAME_MAX_LENGTH) {
    return getFireflyBudgetOverLimitReason('name length', nameLength, FIREFLY_BUDGET_NAME_MAX_LENGTH)
  }
  if (schedule.limits.length > FIREFLY_BUDGET_MAX_LIMIT_PERIODS) {
    return getFireflyBudgetOverLimitReason('limit period count', schedule.limits.length, FIREFLY_BUDGET_MAX_LIMIT_PERIODS)
  }
  if (categoryNames.length > FIREFLY_BUDGET_MAX_CATEGORIES) {
    return getFireflyBudgetOverLimitReason('category count', categoryNames.length, FIREFLY_BUDGET_MAX_CATEGORIES)
  }
  return null
}

/**
 * Says what is wrong with a limit amount for a currency with the given decimal places, or null
 * when the backend would store it
 */
function getLimitAmountProblem(amount: string, exponent: number): string | null {
  if (amount.length > FIREFLY_ROW_FIELD_MAX_LENGTHS.amount) return 'is too long to read'

  const minorUnits = toImportMinorUnits(amount, exponent)
  if (minorUnits === 'unreadable') return 'is not a number'
  if (minorUnits === 'tooPrecise') {
    return exponent === 0 ? 'has decimal places the currency does not use' : `has more than ${exponent} decimal places`
  }
  if (minorUnits === 'tooLarge') return 'is too large to store'
  return minorUnits > 0n ? null : 'is not above zero'
}

/**
 * Whether the two latest limit periods repeat back to back on a day length no
 * Lumina cadence can express
 *
 * That one shape is skipped because its history would arrive intact while the
 * budget could never continue on its own rhythm. A lone irregular window has
 * no rhythm to lose, and a regular history ending on one odd partial period
 * imports not recurring with every period intact, so neither trips this
 */
function repeatsOnUnsupportedCadence(limits: FireflyBudgetImportLimit[]): boolean {
  if (limits.length < 2) return false
  const latest = limits[limits.length - 1]
  if (getFireflyBudgetRecurrence(latest) !== null) return false

  const previous = limits[limits.length - 2]
  return inclusiveDayLength(previous) === inclusiveDayLength(latest)
    && addDays(previous.end, 1) === latest.start
}

/**
 * Reads the cadence a budget continues on off its latest limit period, or null when none fits
 *
 * The backend stores the sent cadence only when validate_period_start and compute_period_end show
 * the latest period is exactly one period of it, which every cadence read here is. A period of
 * whole calendar months from a day-of-month anchor to the day before it continues monthly, or
 * yearly when it spans whole years, and a period of whole weeks continues weekly on its start
 * weekday. Months are tried first, so a 28-day February reads as one month rather than four weeks
 */
export function getFireflyBudgetRecurrence(limit: FireflyBudgetImportLimit): FireflyBudgetImportRecurrence | null {
  const start = parseIsoDateUtc(limit.start)
  const monthCadence = monthCadenceOf(limit)
  if (start !== null && monthCadence !== null) {
    const isYearly = monthCadence.months % MONTHS_PER_YEAR === 0
    const instanceLength = isYearly ? monthCadence.months / MONTHS_PER_YEAR : monthCadence.months
    if (instanceLength > FIREFLY_BUDGET_MAX_INSTANCE_LENGTH) return null
    return {
      freq: isYearly ? 'yearly' : 'monthly',
      instance_length: instanceLength,
      weekday: null,
      dom: monthCadence.dom,
      month: isYearly ? start.getUTCMonth() + 1 : null,
    }
  }

  const days = inclusiveDayLength(limit)
  const weeks = days / DAYS_PER_WEEK
  if (start === null || days <= 0 || !Number.isInteger(weeks) || weeks > FIREFLY_BUDGET_MAX_INSTANCE_LENGTH) return null
  return {
    freq: 'weekly',
    instance_length: weeks,

    // Monday is 0 on the backend, where JavaScript counts from Sunday
    weekday: (start.getUTCDay() + 6) % DAYS_PER_WEEK,
    dom: null,
    month: null,
  }
}

/**
 * Describes how a budget repeats, in words the drafts table can show
 *
 * Multi-unit cadences abbreviate their units so the column stays narrow. A budget skipped for
 * repeating on an unsupported length keeps that length, so the skip reads against it
 */
function describeCadence(
  latest: FireflyBudgetImportLimit,
  recurrence: FireflyBudgetImportRecurrence | null,
  repeatsUnsupported: boolean,
): string {
  if (repeatsUnsupported) return `Every ${inclusiveDayLength(latest)} days`
  if (!recurrence) return 'Not recurring'

  const length = recurrence.instance_length
  if (recurrence.freq === 'weekly') return length === 1 ? 'Weekly' : `Every ${length} wks`
  if (recurrence.freq === 'yearly') return length === 1 ? 'Yearly' : `Every ${length} yrs`
  if (length === 1) return 'Monthly'
  return length === 3 ? 'Quarterly' : `Every ${length} mths`
}

/**
 * Returns the calendar months a limit period spans and the day-of-month anchor it runs from,
 * when it runs from that anchor to the day before it, or null otherwise
 *
 * A start on the last day of a short month could be the capped form of a
 * larger anchor, so those anchors are tried too, and the smallest that fits
 * wins
 */
function monthCadenceOf(limit: FireflyBudgetImportLimit): { months: number; dom: number } | null {
  const start = parseIsoDateUtc(limit.start)
  const followingStart = parseIsoDateUtc(addDays(limit.end, 1))
  if (start === null || followingStart === null) return null

  const months = (followingStart.getUTCFullYear() - start.getUTCFullYear()) * MONTHS_PER_YEAR
    + (followingStart.getUTCMonth() - start.getUTCMonth())
  if (months <= 0) return null

  const startDay = start.getUTCDate()
  const isMonthEndStart = startDay === lastDayOfMonth(start.getUTCFullYear(), start.getUTCMonth())
  const anchors = isMonthEndStart
    ? Array.from({ length: MAX_MONTH_ANCHOR_DAY - startDay + 1 }, (_, offset) => startDay + offset)
    : [startDay]

  const followingMonthIndex = start.getUTCMonth() + months
  for (const anchor of anchors) {
    const anchoredDay = Math.min(anchor, lastDayOfMonth(start.getUTCFullYear(), followingMonthIndex))
    if (Date.UTC(start.getUTCFullYear(), followingMonthIndex, anchoredDay) === followingStart.getTime()) {
      return { months, dom: anchor }
    }
  }
  return null
}

/**
 * Returns how many days a limit period covers, both ends included
 */
function inclusiveDayLength(limit: FireflyBudgetImportLimit): number {
  const start = parseIsoDateUtc(limit.start)
  const end = parseIsoDateUtc(limit.end)
  if (start === null || end === null) return 0
  return Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1
}

/**
 * Returns the ISO date a number of days after the given one
 */
function addDays(value: string, days: number): string {
  const parsed = parseIsoDateUtc(value)
  if (parsed === null) return value
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

/**
 * Parses an ISO date at UTC so day arithmetic never crosses DST boundaries
 */
function parseIsoDateUtc(value: string): Date | null {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(Date.UTC(year, month - 1, day))
}

/**
 * Returns the last calendar day of a month, tolerating overflowed month
 * indexes the way Date.UTC normalises them
 */
function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}
