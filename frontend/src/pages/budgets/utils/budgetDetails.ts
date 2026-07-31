import type { BaseBudget, Budget, BudgetUtilization } from '@/api/budgets'
import type { Category } from '@/api/categories'
import type { BudgetChartPoint } from '@/pages/budgets/components/budget-details-modal/ChartTooltip'
import type { CalendarDate } from '@/pages/budgets/types'
import { nextRecurringPeriodStart } from '@/pages/budgets/utils/budgetPeriods'
import { formatCalendarDate, parseCalendarDate } from '@/pages/budgets/utils/date'
import { DATE_FORMATS, formatDate, getYmdTime } from '@/utils/date'
import { getBudgetUtilizationPercent } from '@/pages/budgets/utils/utilization'
import { getCategoryColorMap } from '@/utils/chartColor'

const BUDGET_CHART_MAX_PERIODS = 12

// Distinguishes synthetic archived gap keys from real period keys on the categorical axis
export const ARCHIVED_SLOT_LABEL_PREFIX = 'archived:'

export type BudgetChartCategory = {
  id: string
  name: string
  kind: Category['kind']
  dataKey: string
  color: string
}

export type BudgetPeriodHistoryEntry = {
  period: Budget
  spent: number
  remaining: number
}

const BUDGET_CHART_MARGIN = { top: 4, right: 8, bottom: 0, left: 0 } as const
const BUDGET_CHART_Y_AXIS_WIDTH = 48
export const BUDGET_CHART_HOVER_HIGHLIGHT_WIDTH = 70

export const BUDGET_CHART_LAYOUT = {
  margin: BUDGET_CHART_MARGIN,
  yAxisWidth: BUDGET_CHART_Y_AXIS_WIDTH,
} as const

/**
 * Sorts periods oldest-to-newest for chart rendering and newest-to-oldest derivations
 */
export function getSortedBudgetPeriods(periods: Budget[]) {
  return periods
    .map((period) => ({ period, startTime: getYmdTime(period.period_start) }))
    .sort((a, b) => a.startTime - b.startTime)
    .map((entry) => entry.period)
}

/**
 * Merges list-level and historical utilization results into a budget-id lookup map
 */
export function getBudgetUtilizationByBudgetId(
  initialLatestUtilization: BudgetUtilization | undefined,
  utilizations: Array<BudgetUtilization | undefined>,
) {
  const utilizationsByBudgetId = new Map<string, BudgetUtilization>()

  if (initialLatestUtilization) {
    utilizationsByBudgetId.set(initialLatestUtilization.budget_id, initialLatestUtilization)
  }

  utilizations
    .filter((utilization): utilization is BudgetUtilization => Boolean(utilization))
    .forEach((utilization) => {
      utilizationsByBudgetId.set(utilization.budget_id, utilization)
    })

  return utilizationsByBudgetId
}

/**
 * Builds category metadata and deterministic colours for the budget details utilization chart,
 * ordered by the latest period's spending from highest to lowest
 *
 * This one order serves the whole chart: recharts stacks the categories in the order they are
 * declared, bottom first, so the biggest current spender sits at the base of every bar, and the
 * tooltip walks the same array, so it lists that category first. A period whose ranking differs
 * from the latest one still draws in this order, since a category cannot change stack position
 * from bar to bar
 *
 * The tracked categories of a budget with no spending yet are all tied at zero, so name and then
 * ID break ties and keep the order from drifting between loads
 */
export function getBudgetChartCategories({
  baseBudget,
  categoryById,
  categoryDetailsById,
  latestUtilization,
}: {
  baseBudget: BaseBudget
  categoryById: Map<string, string>
  categoryDetailsById: Map<string, Category>
  latestUtilization: BudgetUtilization | undefined
}): BudgetChartCategory[] {
  const latestSpentByCategoryId = new Map(
    (latestUtilization?.categories ?? []).map((category) => [category.category_id, category.spent]),
  )
  const trackedCategories = baseBudget.category_ids.map((categoryId) => {
    const category = categoryDetailsById.get(categoryId)

    return {
      id: categoryId,
      name: category?.name ?? categoryById.get(categoryId) ?? 'Uncategorized',
      kind: category?.kind ?? 'expense',
    }
  }).sort((a, b) => {
    // A category the latest period never spent against ranks alongside one that spent nothing
    const spendDifference = (latestSpentByCategoryId.get(b.id) ?? 0) - (latestSpentByCategoryId.get(a.id) ?? 0)
    if (spendDifference !== 0) return spendDifference

    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  })
  const categoryColors = getCategoryColorMap(trackedCategories)

  return trackedCategories.map((category, index) => ({
    ...category,
    dataKey: `categoryPct${index}`,
    color: categoryColors.get(category.id || category.name) ?? 'var(--app-accent)',
  }))
}

/**
 * Returns the ISO 8601 week number and its week-numbering year for a calendar date, where week 1 is
 * the week holding the year's first Thursday and weeks start on Monday
 *
 * The week-numbering year can differ from the calendar year across the January boundary (early
 * January can fall in the previous year's last week and late December in the next year's week 1),
 * so the year is returned alongside the week for labelling that boundary
 */
function getIsoWeek(date: CalendarDate): { week: number; year: number } {
  const target = new Date(Date.UTC(date.year, date.month - 1, date.day))

  // Move to the Thursday of this week so the week-numbering year is the calendar year of that Thursday
  const mondayIndex = (target.getUTCDay() + 6) % 7
  target.setUTCDate(target.getUTCDate() - mondayIndex + 3)
  const isoYear = target.getUTCFullYear()

  // January 4th always lands in ISO week 1, so its Thursday anchors the week count
  const week1Thursday = new Date(Date.UTC(isoYear, 0, 4))
  const week1MondayIndex = (week1Thursday.getUTCDay() + 6) % 7
  week1Thursday.setUTCDate(week1Thursday.getUTCDate() - week1MondayIndex + 3)

  const week = 1 + Math.round((target.getTime() - week1Thursday.getTime()) / (7 * 24 * 60 * 60 * 1000))
  return { week, year: isoYear }
}

/**
 * Builds the chart X-axis label for a period start and whether it carries a year suffix, both derived
 * from the budget's recurrence: weekly budgets read as ISO week numbers, yearly budgets as the year,
 * and monthly budgets as the short month. The year suffix marks the first period of a new year (the
 * first ISO week, or January) so a window that crosses a year boundary still reads unambiguously
 */
function getBudgetChartAxisLabel(
  date: CalendarDate,
  recurrenceFreq: BaseBudget['recurrence_freq'],
): { axisLabel: string; hasYearLabel: boolean } {
  if (recurrenceFreq === 'weekly') {
    const { week, year } = getIsoWeek(date)
    const hasYearLabel = week === 1
    return {
      axisLabel: hasYearLabel ? `W${week} '${String(year).slice(2)}` : `W${week}`,
      hasYearLabel,
    }
  }

  if (recurrenceFreq === 'yearly') {
    return { axisLabel: String(date.year), hasYearLabel: false }
  }

  const hasYearLabel = date.month === 1
  const monthLabel = formatDate(new Date(date.year, date.month - 1, date.day), DATE_FORMATS.month)
  return {
    axisLabel: hasYearLabel ? `${monthLabel} '${String(date.year).slice(2)}` : monthLabel,
    hasYearLabel,
  }
}

/**
 * Builds the chart point for a stored budget period, including its per-category utilization percentages
 */
function buildBudgetPeriodPoint(
  period: Budget,
  utilizationByBudgetId: Map<string, BudgetUtilization>,
  chartCategories: BudgetChartCategory[],
  today: string,
  recurrenceFreq: BaseBudget['recurrence_freq'],
): BudgetChartPoint {
  const utilization = utilizationByBudgetId.get(period.id)
  const periodSpent = utilization?.total_spent ?? 0
  const categorySpentById = new Map(
    (utilization?.categories ?? []).map((category) => [category.category_id, category.spent]),
  )
  const categoryValues = chartCategories.reduce<Record<string, number>>((values, category) => {
    values[category.dataKey] = getBudgetUtilizationPercent(categorySpentById.get(category.id) ?? 0, period.overall_limit)
    return values
  }, {})
  const periodStart = parseCalendarDate(period.period_start)
  const { axisLabel, hasYearLabel } = getBudgetChartAxisLabel(periodStart, recurrenceFreq)

  return {
    periodKey: period.period_start,
    label: formatCalendarDate(periodStart),
    axisLabel,
    hasYearAxisLabel: hasYearLabel,
    spent: periodSpent,
    limit: period.overall_limit,
    utilizationPct: Math.round(getBudgetUtilizationPercent(periodSpent, period.overall_limit)),
    isCurrent: period.period_start <= today && today <= period.period_end,
    categories: chartCategories.map((category) => {
      const categorySpent = categorySpentById.get(category.id) ?? 0

      return {
        id: category.id,
        name: category.name,
        spent: categorySpent,
        utilizationPct: getBudgetUtilizationPercent(categorySpent, period.overall_limit),
        color: category.color,
      }
    }),
    ...categoryValues,
  }
}

/**
 * Builds a zeroed archived point for a cadence step with no stored period, rendering as a shaded
 * gap column instead of a utilization bar
 */
function buildBudgetArchivedPoint(stepYmd: string, chartCategories: BudgetChartCategory[]): BudgetChartPoint {
  const zeroedCategoryValues = chartCategories.reduce<Record<string, number>>((values, category) => {
    values[category.dataKey] = 0
    return values
  }, {})

  return {
    periodKey: `${ARCHIVED_SLOT_LABEL_PREFIX}${stepYmd}`,
    label: '',
    axisLabel: '',
    hasYearAxisLabel: false,
    archived: true,
    spent: 0,
    limit: 0,
    utilizationPct: 0,
    categories: [],
    ...zeroedCategoryValues,
  }
}

/**
 * Builds the cadence-stepped timeline of expected period starts from the first stored period
 * through the end bound, inclusive, so any cycle skipped while archiving surfaces as a gap
 */
function getBudgetChartTimeline(baseBudget: BaseBudget, firstPeriodStart: string, endBoundYmd: string): string[] {
  const timeline = [firstPeriodStart]
  let cursor = firstPeriodStart
  let next = nextRecurringPeriodStart(baseBudget, cursor)

  while (next <= endBoundYmd) {
    timeline.push(next)
    cursor = next
    next = nextRecurringPeriodStart(baseBudget, cursor)
  }

  return timeline
}

/**
 * Converts budget periods and utilization results into the chart rows shown in the details modal
 *
 * One-off budgets never generate follow-on periods, so their chart is simply the latest stored
 * periods. Recurring budgets step forward from the first stored period at the current cadence, up
 * to today while the budget is archived (surfacing any trailing archived stretch), or up to the
 * latest stored period otherwise, so a budget merely awaiting its next backfill shows no trailing
 * band. Any cadence step without a matching stored period renders as a shaded archived gap column
 */
export function getBudgetDetailsChartData({
  sortedPeriods,
  utilizationByBudgetId,
  chartCategories,
  baseBudget,
  today,
}: {
  sortedPeriods: Budget[]
  utilizationByBudgetId: Map<string, BudgetUtilization>
  chartCategories: BudgetChartCategory[]
  baseBudget: BaseBudget
  today: string
}): BudgetChartPoint[] {
  if (!baseBudget.recurs) {
    return sortedPeriods
      .slice(-BUDGET_CHART_MAX_PERIODS)
      .map((period) => buildBudgetPeriodPoint(period, utilizationByBudgetId, chartCategories, today, baseBudget.recurrence_freq))
  }

  const firstPeriod = sortedPeriods[0]
  const latestPeriod = sortedPeriods[sortedPeriods.length - 1]
  if (!firstPeriod || !latestPeriod) return []

  const endBoundYmd = baseBudget.is_archived ? today : latestPeriod.period_start
  const timeline = getBudgetChartTimeline(baseBudget, firstPeriod.period_start, endBoundYmd)
  const windowedTimeline = timeline.slice(-BUDGET_CHART_MAX_PERIODS)
  const periodByStart = new Map(sortedPeriods.map((period) => [period.period_start, period]))

  return windowedTimeline.map((stepYmd) => {
    const period = periodByStart.get(stepYmd)
    return period
      ? buildBudgetPeriodPoint(period, utilizationByBudgetId, chartCategories, today, baseBudget.recurrence_freq)
      : buildBudgetArchivedPoint(stepYmd, chartCategories)
  })
}

/**
 * Builds newest-first period history rows with spent and remaining amounts
 */
export function getBudgetPeriodHistory(
  sortedPeriods: Budget[],
  utilizationByBudgetId: Map<string, BudgetUtilization>,
): BudgetPeriodHistoryEntry[] {
  return sortedPeriods.slice().reverse().map((period) => {
    const utilization = utilizationByBudgetId.get(period.id)
    const spent = utilization?.total_spent ?? 0
    const remaining = period.overall_limit - spent
    return {
      period,
      spent,
      remaining,
    }
  })
}

/**
 * Sorts current-period category spending from highest spend to lowest spend
 */
export function getLatestBudgetCategories(latestUtilization: BudgetUtilization | undefined) {
  return (latestUtilization?.categories ?? [])
    .slice()
    .sort((a, b) => b.spent - a.spent)
}

/**
 * Returns the bar-top percentage recharts actually renders for a chart point: the stacked sum of
 * the shown category percentages once more than one category is tracked, or the total utilization
 * percentage for a single-category chart
 *
 * A period can have historical spend in a category the budget no longer tracks, so the stored total
 * utilization percentage can sit above the sum of the categories still shown on the stacked bar
 * Mirroring the stacked total here keeps the derived y-axis maximum aligned with the tallest bar
 * recharts actually draws rather than with the untracked-inclusive total
 */
export function getBudgetChartBarTopPct(
  point: BudgetChartPoint,
  chartCategories: BudgetChartCategory[],
  isStacked: boolean,
): number {
  if (!isStacked) return point.utilizationPct

  return chartCategories.reduce(
    (total, category) => total + Number((point as unknown as Record<string, unknown>)[category.dataKey] ?? 0),
    0,
  )
}

/**
 * Keeps the bar hover guide within the available chart plot width
 */
export function getBudgetChartGuideMaxWidth(
  chartWidth: number,
  pointCount: number,
  yAxisWidth: number = BUDGET_CHART_LAYOUT.yAxisWidth,
) {
  if (pointCount <= 0) return BUDGET_CHART_HOVER_HIGHLIGHT_WIDTH
  return Math.max(
    1,
    (
      chartWidth -
      BUDGET_CHART_LAYOUT.margin.left -
      BUDGET_CHART_LAYOUT.margin.right -
      yAxisWidth
    ) / pointCount,
  )
}
