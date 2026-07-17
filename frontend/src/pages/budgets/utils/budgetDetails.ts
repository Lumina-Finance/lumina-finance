import type { BaseBudget, Budget, BudgetUtilization } from '@/api/budgets'
import type { Category } from '@/api/categories'
import type { BudgetChartPoint } from '@/pages/budgets/components/budget-details-modal/ChartTooltip'
import { nextRecurringPeriodStart } from '@/pages/budgets/utils/budgetPeriods'
import { formatCalendarDate, parseYmd } from '@/pages/budgets/utils/date'
import { getBudgetUtilizationPercent } from '@/pages/budgets/utils/utilization'
import { getCategoryColorMap } from '@/utils/chartColor'

const BUDGET_CHART_MAX_PERIODS = 6

// Distinguishes synthetic archived slots from real period labels on the categorical axis
export const ARCHIVED_SLOT_LABEL_PREFIX = 'archived:'

export type BudgetArchivedChartSlot = {
  // Unique categorical axis label that positions the shaded band between two bars
  label: string
  // Id of the period the shaded band is inserted after
  afterPeriodId: string
}

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
  return periods.slice().sort((a, b) => a.period_start.localeCompare(b.period_start))
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
 * Builds category metadata and deterministic colours for the budget details utilization chart
 */
export function getBudgetChartCategories({
  baseBudget,
  categoryById,
  categoryDetailsById,
}: {
  baseBudget: BaseBudget
  categoryById: Map<string, string>
  categoryDetailsById: Map<string, Category>
}): BudgetChartCategory[] {
  const trackedCategories = baseBudget.category_ids.map((categoryId) => {
    const category = categoryDetailsById.get(categoryId)

    return {
      id: categoryId,
      name: category?.name ?? categoryById.get(categoryId) ?? 'Uncategorized',
      kind: category?.kind ?? 'expense',
    }
  })
  const categoryColors = getCategoryColorMap(trackedCategories)

  return trackedCategories.map((category, index) => ({
    ...category,
    dataKey: `categoryPct${index}`,
    color: categoryColors.get(category.id || category.name) ?? 'var(--app-accent)',
  }))
}

/**
 * Detects archived stretches inside a chart period window and returns the shaded slots to insert between bars
 *
 * Archiving pauses period generation, so a stored period that starts later than the recurrence cadence would
 * place it marks a skipped, archived stretch. When the base budget is still archived the final slot shades from
 * the last stored period onward since no later period brackets the gap
 */
export function getBudgetArchivedChartSlots(
  shownPeriods: Budget[],
  baseBudget: BaseBudget,
): BudgetArchivedChartSlot[] {
  // One-off budgets never generate follow-on periods, so a gap cannot signal archiving
  if (!baseBudget.recurs) return []

  const slots: BudgetArchivedChartSlot[] = []
  for (let index = 0; index < shownPeriods.length - 1; index += 1) {
    const current = shownPeriods[index]
    const next = shownPeriods[index + 1]

    // A later-than-expected next start means at least one cycle was skipped while archived
    if (next.period_start > nextRecurringPeriodStart(baseBudget, current.period_start)) {
      slots.push({ label: `${ARCHIVED_SLOT_LABEL_PREFIX}${current.id}`, afterPeriodId: current.id })
    }
  }

  const lastPeriod = shownPeriods[shownPeriods.length - 1]
  if (baseBudget.is_archived && lastPeriod) {
    slots.push({ label: `${ARCHIVED_SLOT_LABEL_PREFIX}${lastPeriod.id}-current`, afterPeriodId: lastPeriod.id })
  }

  return slots
}

/**
 * Converts budget periods and utilization results into the chart rows shown in the details modal
 */
export function getBudgetDetailsChartData({
  sortedPeriods,
  utilizationByBudgetId,
  chartCategories,
  baseBudget,
}: {
  sortedPeriods: Budget[]
  utilizationByBudgetId: Map<string, BudgetUtilization>
  chartCategories: BudgetChartCategory[]
  baseBudget: BaseBudget
}): BudgetChartPoint[] {
  const shownPeriods = sortedPeriods.slice(-BUDGET_CHART_MAX_PERIODS)
  const archivedSlotByPeriodId = new Map(
    getBudgetArchivedChartSlots(shownPeriods, baseBudget).map((slot) => [slot.afterPeriodId, slot]),
  )

  // Archived slots carry zeroed category values so their empty column renders no bar behind the shaded band
  const zeroedCategoryValues = chartCategories.reduce<Record<string, number>>((values, category) => {
    values[category.dataKey] = 0
    return values
  }, {})

  return shownPeriods.flatMap((period) => {
    const utilization = utilizationByBudgetId.get(period.id)
    const periodSpent = utilization?.total_spent ?? 0
    const categorySpentById = new Map(
      (utilization?.categories ?? []).map((category) => [category.category_id, category.spent]),
    )
    const categoryValues = chartCategories.reduce<Record<string, number>>((values, category) => {
      values[category.dataKey] = getBudgetUtilizationPercent(categorySpentById.get(category.id) ?? 0, period.overall_limit)
      return values
    }, {})

    const periodPoint: BudgetChartPoint = {
      label: formatCalendarDate(parseYmd(period.period_start)),
      spent: periodSpent,
      limit: period.overall_limit,
      utilizationPct: Math.round(getBudgetUtilizationPercent(periodSpent, period.overall_limit)),
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

    const archivedSlot = archivedSlotByPeriodId.get(period.id)
    if (!archivedSlot) return [periodPoint]

    const archivedPoint: BudgetChartPoint = {
      label: archivedSlot.label,
      archived: true,
      spent: 0,
      limit: 0,
      utilizationPct: 0,
      categories: [],
      ...zeroedCategoryValues,
    }
    return [periodPoint, archivedPoint]
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
 * Keeps the bar hover guide within the available chart plot width
 */
export function getBudgetChartGuideMaxWidth(chartWidth: number, pointCount: number) {
  if (pointCount <= 0) return BUDGET_CHART_HOVER_HIGHLIGHT_WIDTH
  return Math.max(
    1,
    (
      chartWidth -
      BUDGET_CHART_LAYOUT.margin.left -
      BUDGET_CHART_LAYOUT.margin.right -
      BUDGET_CHART_LAYOUT.yAxisWidth
    ) / pointCount,
  )
}
