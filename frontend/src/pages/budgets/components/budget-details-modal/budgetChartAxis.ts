// The Y axis always shows at least this much so the 100% budget threshold stays on the visible axis
const BUDGET_CHART_MIN_AXIS_MAX_PCT = 100

// Margin kept above the taller of the tallest bar or the 100% line, so a bar's rounded top and the
// limit line both keep a little breathing room without padding the domain up to the next full step
const BUDGET_CHART_AXIS_HEADROOM_PCT = 5

// Tick step tiers keyed by how tall the tallest bar is, so labels stay round and few (0/25/50/.../100)
// for typical utilization and coarsen as bars run further over budget. Every step evenly divides
// BUDGET_CHART_MIN_AXIS_MAX_PCT, so the 100% threshold always lands on a tick
const BUDGET_CHART_AXIS_TIER_1_MAX_PCT = 100
const BUDGET_CHART_AXIS_TIER_1_STEP_PCT = 25
const BUDGET_CHART_AXIS_TIER_2_MAX_PCT = 250
const BUDGET_CHART_AXIS_TIER_2_STEP_PCT = 50
const BUDGET_CHART_AXIS_TIER_3_STEP_PCT = 100

import type { BudgetChartPoint } from '@/pages/budgets/components/budget-details-modal/ChartTooltip'

// Every other period label renders on mobile, so a wide label like "Jan '26" never sits close
// enough to its neighbour to collide with it
const BUDGET_CHART_MOBILE_AXIS_LABEL_STEP = 2

// At or below this many points, bands are wide enough that even the year label fits without
// colliding, so mobile shows every label just like desktop instead of thinning them out
const BUDGET_CHART_MOBILE_FULL_LABEL_MAX_POINTS = 6

/**
 * Picks which chart points keep an X-axis label on mobile, thinning a full window down to an evenly
 * spaced subset so a wide label like "Jan '26" never sits close enough to a neighbour to collide
 *
 * Returns null when there are few enough points that every label already fits, meaning show all of
 * them. Otherwise the subset is spaced every {@link BUDGET_CHART_MOBILE_AXIS_LABEL_STEP} points,
 * anchored on the first period whose label carries the year suffix so that label is never the one
 * skipped, falling back to the current period and then the last point when no period starts in
 * January. The current period's key is always added on top of the spacing so the in-progress period
 * never loses its accent label and dot
 */
export function getMobileAxisLabelKeys(chartData: BudgetChartPoint[]): Set<string> | null {
  if (chartData.length <= BUDGET_CHART_MOBILE_FULL_LABEL_MAX_POINTS) return null

  const yearLabelIndex = chartData.findIndex((point) => point.hasYearAxisLabel)
  const currentPeriodIndex = chartData.findIndex((point) => point.isCurrent)
  const anchorIndex = yearLabelIndex >= 0 ? yearLabelIndex : currentPeriodIndex >= 0 ? currentPeriodIndex : chartData.length - 1

  const labelKeys = new Set(
    chartData
      .filter((_, index) => (index - anchorIndex) % BUDGET_CHART_MOBILE_AXIS_LABEL_STEP === 0)
      .map((point) => point.periodKey),
  )

  if (currentPeriodIndex >= 0) labelKeys.add(chartData[currentPeriodIndex].periodKey)

  return labelKeys
}

export type BudgetChartAxis = {
  max: number
  ticks: number[]
}

/**
 * Picks a round tick step and axis maximum for the utilization Y axis instead of letting Recharts
 * auto-generate ticks against an arbitrary maximum, which produces uneven labels (such as
 * 45/90/135) rather than clean, evenly spaced ones
 *
 * The domain maximum sits a small fixed margin above the taller of the tallest bar or the 100%
 * line, rather than rounding up to the next full step, so an over-budget bar keeps only a little
 * headroom instead of a large empty gap. The tick labels still land on the chosen step, so the
 * highest label is the greatest step multiple that fits under the domain maximum and the padded
 * top itself stays unlabelled
 */
export function getBudgetChartAxis(dataMax: number): BudgetChartAxis {
  const effectiveMax = Math.max(dataMax, BUDGET_CHART_MIN_AXIS_MAX_PCT)
  const step =
    effectiveMax <= BUDGET_CHART_AXIS_TIER_1_MAX_PCT
      ? BUDGET_CHART_AXIS_TIER_1_STEP_PCT
      : effectiveMax <= BUDGET_CHART_AXIS_TIER_2_MAX_PCT
        ? BUDGET_CHART_AXIS_TIER_2_STEP_PCT
        : BUDGET_CHART_AXIS_TIER_3_STEP_PCT
  const max = Math.max(Math.ceil(dataMax), BUDGET_CHART_MIN_AXIS_MAX_PCT) + BUDGET_CHART_AXIS_HEADROOM_PCT
  const highestTick = Math.floor(max / step) * step
  const ticks = Array.from({ length: highestTick / step + 1 }, (_, index) => index * step)

  return { max, ticks }
}
