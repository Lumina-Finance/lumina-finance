import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type {
  FireflyBudgetImportBudget,
  FireflyBudgetImportLimit,
  FireflyBudgetImportRecurrence,
} from '@/api/firefly-imports'
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
  getFireflyBudgetAmountReason,
  getFireflyBudgetGroupCategoryReason,
  getFireflyBudgetOverLimitReason,
  getFireflyBudgetUnsupportedCurrencyReason,
} from '@/pages/imports/firefly/constants'
import type { FireflyBudgetDraft } from '@/pages/imports/firefly/types'
import { toImportMinorUnits } from '@/pages/imports/utils/valueParsers'
import { parseYmd } from '@/utils/date'
import { countCharacters, getFireflyRowDate, isFireflyRowUploadable } from './derivation'

const DAYS_PER_WEEK = 7
const MONTHS_PER_YEAR = 12

// Highest configurable day-of-month anchor, which a period starting on the
// last day of a short month could be the capped form of
const MAX_MONTH_ANCHOR_DAY = 31

/**
 * How transactions in the export reference one budget name
 */
interface FireflyBudgetUsage {
  earliestDate: string
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
 * commit imports, which leaves category IDs to be resolved from the commit
 * response afterwards. A budget the backend would refuse is skipped with its
 * reason, since the budget upload is all or nothing
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
  for (const row of transactionRows) {
    const budgetName = row.budget?.trim()
    if (!budgetName) continue

    // Rows dropped before upload never register category sources in the
    // commit response, so they cannot vote on a budget's tracked categories
    if (!isFireflyRowUploadable(row)) continue

    const rowDate = getFireflyRowDate(row.date ?? '')
    const usage = usageByName.get(budgetName) ?? { earliestDate: '', categoryNames: new Set<string>() }
    if (rowDate && (!usage.earliestDate || rowDate < usage.earliestDate)) usage.earliestDate = rowDate

    const category = row.category?.trim()
    if (category) usage.categoryNames.add(category)
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
 * Turns budget drafts into the commit payload by resolving each draft's export
 * category names through the category IDs the transactions commit reported
 *
 * Every distinct row category is an import source, so the response carries all
 * of them, and a name that is somehow absent is dropped rather than failing the
 * budget it belongs to
 */
export function buildFireflyBudgetImportBudgets(
  drafts: FireflyBudgetDraft[],
  categorySourceIds: Record<string, string>,
): FireflyBudgetImportBudget[] {
  return drafts.map((draft) => {
    const categoryIds: string[] = []
    const seenIds = new Set<string>()

    for (const categoryName of draft.categoryNames) {
      const categoryId = categorySourceIds[categoryName]
      if (!categoryId || seenIds.has(categoryId)) continue
      seenIds.add(categoryId)
      categoryIds.push(categoryId)
    }

    return {
      name: draft.name,
      currency: draft.currencyCode,
      category_ids: categoryIds,
      limits: draft.limits,
      recurrence: draft.recurrence,
      is_archived: draft.isArchived,
    }
  })
}

/**
 * Finds the budget a budget import error names
 *
 * Every error the budget import raises for one budget starts with its name and a colon, and the
 * longest matching name wins, so an error about "Car insurance" never lands on "Car"
 */
export function findFireflyBudgetNamedInError(names: string[], detail: string): string | undefined {
  let named: string | undefined
  for (const name of names) {
    if (detail.startsWith(`${name}: `) && (!named || name.length > named.length)) named = name
  }
  return named
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
    // the backend failing the whole batch
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

  const disabledReason = !usage || !usage.earliestDate
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
    amount: latest?.amount ?? '',
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
 * The budget upload is all or nothing, so each of these would fail every budget with it
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
