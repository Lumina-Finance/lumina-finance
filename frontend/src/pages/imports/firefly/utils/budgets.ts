import type { FireflyBudgetImportBudget, FireflyBudgetImportLimit } from '@/api/fireflyImports'
import type { CsvRow, ImportFileDraft } from '../../types'
import {
  FIREFLY_BUDGET_ACTIVE_VALUE,
  FIREFLY_BUDGET_ARCHIVED_REASON,
  FIREFLY_BUDGET_MIXED_CURRENCIES_REASON,
  FIREFLY_BUDGET_NO_CATEGORIES_REASON,
  FIREFLY_BUDGET_NO_LIMITS_REASON,
  FIREFLY_BUDGET_NO_TRANSACTIONS_REASON,
  FIREFLY_BUDGET_UNREADABLE_DATES_REASON,
  FIREFLY_BUDGET_UNSUPPORTED_CADENCE_REASON,
} from '../constants'
import type { FireflyBudgetDraft } from '../types'
import { getFireflyRowDate, isFireflyRowUploadable, isRealCalendarDate } from './derivation'

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
 * Derives importable budget drafts from the budgets export and the staged
 * transaction rows
 *
 * Drafts derive before the commit so the budget preview can drive what the
 * commit imports, which leaves category IDs to be resolved from the commit
 * response afterwards
 */
export function buildFireflyBudgetDrafts({
  budgetsFile,
  transactionRows,
}: {
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

  const drafts: FireflyBudgetDraft[] = []
  for (const [name, budget] of rowsByName) {
    drafts.push(buildBudgetDraft(name, budget, usageByName.get(name)))
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
    }
  })
}

/**
 * Builds the sorted limit period schedule for one budget from its export rows
 *
 * Rows missing a date, amount, or currency cannot place a period in the
 * schedule and are dropped, and exact duplicate rows collapse to one entry
 * while conflicting rows over the same days pass through for the backend to
 * reject
 */
function buildLimitSchedule(limitRows: FireflyLimitRow[]): {
  limits: FireflyBudgetImportLimit[]
  currencyCodes: string[]
  hasUnreadableDates: boolean
} {
  const seen = new Set<string>()
  const limits: FireflyBudgetImportLimit[] = []
  const currencyCodes = new Set<string>()
  let hasUnreadableDates = false

  // The currency is recorded before deduplication and is part of the
  // duplicate key, because Firefly III can hold one limit per currency over
  // the same window and collapsing those would silently drop a currency
  // instead of skipping the budget as mixed
  for (const row of limitRows) {
    if (!row.start || !row.end || !row.amount || !row.currencyCode) continue

    // A present date that names no real day marks the file as corrupted, so
    // the budget is refused loudly rather than the row quietly vanishing or
    // the backend failing the whole batch
    if (!isRealCalendarDate(row.start) || !isRealCalendarDate(row.end)) {
      hasUnreadableDates = true
      continue
    }

    currencyCodes.add(row.currencyCode)
    const key = `${row.start} ${row.end} ${row.amount} ${row.currencyCode}`
    if (seen.has(key)) continue
    seen.add(key)
    limits.push({ start: row.start, end: row.end, amount: row.amount })
  }

  return {
    limits: limits.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end)),
    currencyCodes: [...currencyCodes].sort(),
    hasUnreadableDates,
  }
}

/**
 * Resolves one budget name into a draft, disabling it when the export cannot
 * back a Lumina budget
 */
function buildBudgetDraft(
  name: string,
  budget: FireflyBudgetRows,
  usage: FireflyBudgetUsage | undefined,
): FireflyBudgetDraft {
  const categoryNames = [...usage?.categoryNames ?? []].sort((a, b) => a.localeCompare(b))
  const { limits, currencyCodes, hasUnreadableDates } = buildLimitSchedule(budget.limitRows)
  const latest = limits.length > 0 ? limits[limits.length - 1] : null

  // The most recent period decides the amount and currency the drafts table
  // displays, while the full schedule travels to the backend
  const latestCurrency = [...budget.limitRows]
    .filter((row) => row.start && row.end && row.amount && row.currencyCode)
    .sort((a, b) => a.start.localeCompare(b.start))
    .pop()?.currencyCode ?? ''

  // Being archived is checked before the rest because it settles the budget
  // on its own, whatever its transactions and limit periods look like
  const disabledReason = budget.isArchived
    ? FIREFLY_BUDGET_ARCHIVED_REASON
    : !usage || !usage.earliestDate
      ? FIREFLY_BUDGET_NO_TRANSACTIONS_REASON
      : categoryNames.length === 0
        ? FIREFLY_BUDGET_NO_CATEGORIES_REASON
        : hasUnreadableDates
          ? FIREFLY_BUDGET_UNREADABLE_DATES_REASON
          : !latest
            ? FIREFLY_BUDGET_NO_LIMITS_REASON
            : currencyCodes.length > 1
              ? FIREFLY_BUDGET_MIXED_CURRENCIES_REASON
              : repeatsOnUnsupportedCadence(limits)
                ? FIREFLY_BUDGET_UNSUPPORTED_CADENCE_REASON
                : null

  return {
    name,
    amount: latest?.amount ?? '',
    currencyCode: latestCurrency,
    currencyCodes,
    isArchived: budget.isArchived,
    limits,
    firstPeriodStart: limits.length > 0 ? limits[0].start : null,
    lastPeriodEnd: latest?.end ?? null,
    periodLabel: latest ? describePeriodShape(latest, limits.length === 1) : null,
    categoryNames,
    disabledReason,
  }
}

/**
 * Whether the two latest limit periods repeat back to back on a day length no
 * Lumina cadence can express
 *
 * That one shape is skipped because its history would arrive intact while the
 * budget could never continue on its own rhythm. A lone irregular window is a
 * one-off with no rhythm to lose, and a regular history ending on one odd
 * partial period still continues on a real cadence, so neither trips this
 */
function repeatsOnUnsupportedCadence(limits: FireflyBudgetImportLimit[]): boolean {
  if (limits.length < 2) return false
  const latest = limits[limits.length - 1]
  if (isSupportedPeriodShape(latest)) return false

  const previous = limits[limits.length - 2]
  return inclusiveDayLength(previous) === inclusiveDayLength(latest)
    && addDays(previous.end, 1) === latest.start
}

/**
 * Whether a limit period spans whole calendar months or whole weeks, which
 * are the shapes a Lumina budget cadence can continue
 */
function isSupportedPeriodShape(limit: FireflyBudgetImportLimit): boolean {
  return monthSpanOf(limit) !== null || inclusiveDayLength(limit) % DAYS_PER_WEEK === 0
}

/**
 * Describes how one limit period repeats, in words the drafts table can show
 *
 * Multi-unit cadences abbreviate their units so the column stays narrow
 */
function describePeriodShape(limit: FireflyBudgetImportLimit, isOnly: boolean): string {
  const months = monthSpanOf(limit)
  if (months === 1) return 'Monthly'
  if (months === 3) return 'Quarterly'
  if (months === MONTHS_PER_YEAR) return 'Yearly'
  if (months !== null) {
    return months % MONTHS_PER_YEAR === 0 ? `Every ${months / MONTHS_PER_YEAR} yrs` : `Every ${months} mths`
  }

  const days = inclusiveDayLength(limit)
  if (days % DAYS_PER_WEEK === 0) {
    return days === DAYS_PER_WEEK ? 'Weekly' : `Every ${days / DAYS_PER_WEEK} wks`
  }
  return isOnly ? 'One-off' : `Every ${days} days`
}

/**
 * Returns the calendar months a limit period spans when it runs from a
 * day-of-month anchor to the day before that anchor, or null otherwise
 *
 * A start on the last day of a short month could be the capped form of a
 * larger anchor, so those anchors are tried too, mirroring how the backend
 * reads the cadence off a period
 */
function monthSpanOf(limit: FireflyBudgetImportLimit): number | null {
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
      return months
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
