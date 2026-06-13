import type { DailyCashFlow } from '@/api/transactions'
import { parseYmdLocal } from '@/transactions/utils/date'

export type DailyCashFlowChartMode = 'net' | 'gross'
export type DailyCashFlowGranularity = 'day' | 'week' | 'month'

export type DailyCashFlowPoint = {
  key: string
  date: string
  rangeLabel: string
  inflow: number
  outflow: number
  net: number
}

const DAILY_CASH_FLOW_RANGE_DAY_COUNT = 31
const WEEKLY_CASH_FLOW_RANGE_DAY_COUNT = 183
const DAILY_CASH_FLOW_MAX_X_AXIS_TICK_COUNT = 10
const DAILY_CASH_FLOW_X_AXIS_TICK_SPACING = 64
const DAILY_CASH_FLOW_X_AXIS_CANDIDATE_STEPS = [1, 2, 3, 4, 5, 7, 10, 14, 15, 21, 30] as const

export const DAILY_CASH_FLOW_CHART_MARGIN = { top: 4, right: 12, bottom: 0, left: 12 } as const
export const DAILY_CASH_FLOW_X_AXIS_PADDING = { left: 20, right: 20 } as const

/**
 * Formats a Date as a local YYYY-MM-DD key for comparing bucket boundaries without UTC conversion
 */
function formatYmdLocal(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

/**
 * Chooses the chart bucket size from the selected date range so dense ranges stay readable
 */
export function getDailyCashFlowGranularity(fromDate: string, toDate: string): DailyCashFlowGranularity {
  if (fromDate > toDate) return 'day'

  const from = parseYmdLocal(fromDate)
  const to = parseYmdLocal(toDate)
  const dayCount = Math.max(
    1,
    Math.round((to.getTime() - from.getTime()) / 86400000) + 1,
  )

  if (dayCount <= DAILY_CASH_FLOW_RANGE_DAY_COUNT) return 'day'
  if (dayCount <= WEEKLY_CASH_FLOW_RANGE_DAY_COUNT) return 'week'
  return 'month'
}

/**
 * Returns the cadence word used in the cash-flow chart title
 */
export function getDailyCashFlowCadenceTitle(granularity: DailyCashFlowGranularity) {
  if (granularity === 'week') return 'Weekly'
  if (granularity === 'month') return 'Monthly'
  return 'Daily'
}

/**
 * Returns the period noun used by cash-flow calculation tooltip text
 */
function getDailyCashFlowPeriodName(granularity: DailyCashFlowGranularity) {
  if (granularity === 'week') return 'week'
  if (granularity === 'month') return 'month'
  return 'day'
}

/**
 * Builds the calculation tooltip message for net and gross cash-flow modes
 */
export function getDailyCashFlowCalculation(
  granularity: DailyCashFlowGranularity,
  mode: DailyCashFlowChartMode,
) {
  const period = getDailyCashFlowPeriodName(granularity)
  return mode === 'net'
    ? `Each ${period}'s money in minus money out. Transfers count except Balance Adjustment.`
    : `Each ${period}'s money in and money out. Transfers count except Balance Adjustment.`
}

/**
 * Formats the short label shown on the chart X-axis
 */
function formatCashFlowPointLabel(date: Date, granularity: DailyCashFlowGranularity) {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: granularity === 'month' ? undefined : 'numeric',
  })
}

/**
 * Formats one date in the fuller tooltip label
 */
function formatCashFlowTooltipDate(date: Date) {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Formats a tooltip label that includes the full bucket range for weekly and monthly points
 */
function formatCashFlowRangeLabel(start: Date, end: Date, granularity: DailyCashFlowGranularity) {
  if (granularity === 'day' || formatYmdLocal(start) === formatYmdLocal(end)) {
    return formatCashFlowTooltipDate(start)
  }

  return `${formatCashFlowTooltipDate(start)} - ${formatCashFlowTooltipDate(end)}`
}

/**
 * Converts API daily cash-flow buckets into the data points rendered by the chart
 */
export function getDailyCashFlowSeries(
  raw: DailyCashFlow[],
  granularity: DailyCashFlowGranularity,
): DailyCashFlowPoint[] {
  return raw.map((entry) => {
    const bucketStart = parseYmdLocal(entry.date)
    const bucketEnd = parseYmdLocal(entry.end_date)

    return {
      key: entry.date,
      date: formatCashFlowPointLabel(bucketStart, granularity),
      rangeLabel: formatCashFlowRangeLabel(bucketStart, bucketEnd, granularity),
      inflow: entry.inflow,
      outflow: entry.outflow,
      net: entry.inflow + entry.outflow,
    }
  })
}

/**
 * Calculates the maximum X-axis tick count that can fit in the current chart width
 */
export function getDailyCashFlowXAxisTickCount(chartWidth: number | undefined) {
  if (chartWidth === undefined) return DAILY_CASH_FLOW_MAX_X_AXIS_TICK_COUNT

  const usableWidth = Math.max(
    chartWidth
      - DAILY_CASH_FLOW_CHART_MARGIN.left
      - DAILY_CASH_FLOW_CHART_MARGIN.right
      - DAILY_CASH_FLOW_X_AXIS_PADDING.left
      - DAILY_CASH_FLOW_X_AXIS_PADDING.right,
    0,
  )

  return Math.max(
    2,
    Math.min(
      DAILY_CASH_FLOW_MAX_X_AXIS_TICK_COUNT,
      Math.floor(usableWidth / DAILY_CASH_FLOW_X_AXIS_TICK_SPACING) + 1,
    ),
  )
}

/**
 * Builds candidate tick indexes for one step size while preserving the final data point
 */
function getDailyCashFlowXAxisTickIndexesForStep(dataLength: number, step: number) {
  const lastIndex = dataLength - 1
  const indexes: number[] = []

  // Candidate indexes intentionally stop before the final point so the last bucket can be merged or appended
  for (let index = 0; index < lastIndex; index += step) {
    indexes.push(index)
  }

  const finalGap = lastIndex - indexes[indexes.length - 1]
  if (finalGap === 0) return indexes

  if (indexes.length > 1 && finalGap < step / 2) {
    indexes[indexes.length - 1] = lastIndex
    return indexes
  }

  return [...indexes, lastIndex]
}

/**
 * Selects readable X-axis tick indexes while keeping the first and last buckets visible
 */
function getDailyCashFlowXAxisTickIndexes(dataLength: number, maxTickCount: number) {
  const cappedTickCount = Math.min(maxTickCount, dataLength)
  if (cappedTickCount === 0) return []
  if (cappedTickCount === 1) return [0]

  const lastIndex = dataLength - 1
  const minimumStep = Math.max(1, Math.ceil(lastIndex / (cappedTickCount - 1)))
  const candidateSteps = DAILY_CASH_FLOW_X_AXIS_CANDIDATE_STEPS.some((step) => step === minimumStep)
    ? DAILY_CASH_FLOW_X_AXIS_CANDIDATE_STEPS
    : [...DAILY_CASH_FLOW_X_AXIS_CANDIDATE_STEPS, minimumStep].sort((a, b) => a - b)

  let bestIndexes = [0, lastIndex]
  let bestScore = Number.POSITIVE_INFINITY

  // Scoring favours even spacing but allows fewer ticks when that avoids a crowded final label
  for (const step of candidateSteps) {
    if (step < minimumStep) continue

    const indexes = getDailyCashFlowXAxisTickIndexesForStep(dataLength, step)
    if (indexes.length > cappedTickCount) continue

    const gaps = indexes.slice(1).map((index, gapIndex) => index - indexes[gapIndex])
    const gapSpread = Math.max(...gaps) - Math.min(...gaps)
    const unusedTickPenalty = (cappedTickCount - indexes.length) * 0.2
    const score = gapSpread / step + unusedTickPenalty

    if (score < bestScore) {
      bestIndexes = indexes
      bestScore = score
    }
  }

  return bestIndexes
}

/**
 * Returns the data keys Recharts should render as X-axis ticks
 */
export function getDailyCashFlowXAxisTicks(data: DailyCashFlowPoint[], maxTickCount: number) {
  return getDailyCashFlowXAxisTickIndexes(data.length, maxTickCount).map((index) => (
    data[index].key
  ))
}
