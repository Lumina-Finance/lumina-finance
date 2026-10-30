import type { DailyCashFlow } from '@/api/transactions'
import { getChartGranularity, type ChartGranularity } from '@/utils/chartGranularity'
import { getYearAxisTicks } from '@/utils/chartYearAxis'
import { DATE_FORMATS, formatDate, formatDateRange, formatUnreadableRange, formatYmd, parseYmd } from '@/utils/date'

export type DailyCashFlowChartMode = 'net' | 'gross'
export type DailyCashFlowGranularity = ChartGranularity

export type DailyCashFlowPoint = {
  key: string
  // What the axis writes under the point, which repeats across years, so the point is found by key
  date: string
  // Whether the label carries the year, which marks where the year turns on a monthly range over two calendar years
  marksYear: boolean
  rangeLabel: string
  inflow: number
  outflow: number
  net: number
}

const DAILY_CASH_FLOW_MAX_X_AXIS_TICK_COUNT = 10
const DAILY_CASH_FLOW_X_AXIS_TICK_SPACING = 64
const DAILY_CASH_FLOW_X_AXIS_CANDIDATE_STEPS = [1, 2, 3, 4, 5, 7, 10, 14, 15, 21, 30] as const

export const DAILY_CASH_FLOW_CHART_MARGIN = { top: 4, right: 12, bottom: 0, left: 12 } as const
export const DAILY_CASH_FLOW_X_AXIS_PADDING = { left: 20, right: 20 } as const

/**
 * Chooses the chart bucket size from the selected date range so dense ranges stay readable
 */
export function getDailyCashFlowGranularity(fromDate: string, toDate: string): DailyCashFlowGranularity {
  if (fromDate > toDate) return 'day'

  const from = parseYmd(fromDate)
  const to = parseYmd(toDate)
  if (!from || !to) return 'day'

  const dayCount = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1)

  return getChartGranularity(dayCount)
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
export function getDailyCashFlowCalculation(granularity: DailyCashFlowGranularity, mode: DailyCashFlowChartMode) {
  const period = getDailyCashFlowPeriodName(granularity)
  return mode === 'net'
    ? `Each ${period}'s money in minus money out. Transfers count except Balance Adjustment.`
    : `Each ${period}'s money in and money out. Transfers count except Balance Adjustment.`
}

/**
 * Formats the short label shown on the chart X-axis
 */
function formatCashFlowPointLabel(date: Date, granularity: DailyCashFlowGranularity, marksYear: boolean) {
  if (granularity !== 'month') return formatDate(date, DATE_FORMATS.monthDay)
  return formatDate(date, marksYear ? DATE_FORMATS.monthYear : DATE_FORMATS.month)
}

/**
 * Formats one date in the fuller tooltip label
 */
function formatCashFlowTooltipDate(date: Date) {
  return formatDate(date, DATE_FORMATS.monthDayYear)
}

/**
 * Formats a tooltip label that includes the full bucket range for weekly and monthly points
 */
function formatCashFlowRangeLabel(start: Date, end: Date, granularity: DailyCashFlowGranularity) {
  if (granularity === 'day' || formatYmd(start) === formatYmd(end)) {
    return formatCashFlowTooltipDate(start)
  }

  return formatDateRange(start, end, DATE_FORMATS.monthDayYear)
}

/**
 * Converts API daily cash-flow buckets into the data points rendered by the chart
 */
export function getDailyCashFlowSeries(
  raw: DailyCashFlow[],
  granularity: DailyCashFlowGranularity,
  crossesYear: boolean,
): DailyCashFlowPoint[] {
  return raw.map((entry) => {
    const bucketStart = parseYmd(entry.date)
    const bucketEnd = parseYmd(entry.end_date)
    // A monthly range over two calendar years repeats months, so each January label names its year
    const marksYear = crossesYear && granularity === 'month' && bucketStart !== null && bucketStart.getMonth() === 0

    // A bucket dated with a day that does not exist falls back to its raw bounds, so the bar keeps
    // its amounts and stays in the totals instead of vanishing over a label the chart cannot build
    return {
      key: entry.date,
      date: bucketStart ? formatCashFlowPointLabel(bucketStart, granularity, marksYear) : entry.date,
      marksYear,
      rangeLabel:
        bucketStart && bucketEnd
          ? formatCashFlowRangeLabel(bucketStart, bucketEnd, granularity)
          : formatUnreadableRange(entry.date, entry.end_date),
      inflow: entry.inflow,
      outflow: entry.outflow,
      net: entry.inflow + entry.outflow,
    }
  })
}

/**
 * The width the X-axis labels are drawn along, which is the chart's width less its margins and axis padding
 */
export function getDailyCashFlowPlotWidth(chartWidth: number) {
  return Math.max(
    chartWidth -
      DAILY_CASH_FLOW_CHART_MARGIN.left -
      DAILY_CASH_FLOW_CHART_MARGIN.right -
      DAILY_CASH_FLOW_X_AXIS_PADDING.left -
      DAILY_CASH_FLOW_X_AXIS_PADDING.right,
    0,
  )
}

/**
 * Calculates the maximum X-axis tick count that can fit in the current chart width
 */
export function getDailyCashFlowXAxisTickCount(chartWidth: number | undefined) {
  if (chartWidth === undefined) return DAILY_CASH_FLOW_MAX_X_AXIS_TICK_COUNT

  const usableWidth = getDailyCashFlowPlotWidth(chartWidth)

  return Math.max(
    2,
    Math.min(DAILY_CASH_FLOW_MAX_X_AXIS_TICK_COUNT, Math.floor(usableWidth / DAILY_CASH_FLOW_X_AXIS_TICK_SPACING) + 1),
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
 * Returns the data keys Recharts should render as X-axis ticks: the buckets that name the year when a
 * monthly range crosses one, so no month repeats unplaced, and otherwise evenly spaced buckets
 * that keep the first and last
 *
 * @param plotWidth - The width the labels are drawn along, in pixels, or 0 before it is measured
 */
export function getDailyCashFlowXAxisTicks(data: DailyCashFlowPoint[], maxTickCount: number, plotWidth: number) {
  const yearTicks = getYearAxisTicks(
    data.map((point) => ({ label: point.date, key: point.key, marksYear: point.marksYear })),
    plotWidth,
  )
  return yearTicks ?? getDailyCashFlowXAxisTickIndexes(data.length, maxTickCount).map((index) => data[index].key)
}
