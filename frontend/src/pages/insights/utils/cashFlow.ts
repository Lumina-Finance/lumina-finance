import type { InsightsCashFlowResponse } from '@/api/insights'
import { getRechartsTooltipPoint, type RechartsTooltipState } from '@/components/charts/rechartsTooltip'
import type { CashFlowBarBucket } from '@/pages/insights/types/cashFlow'
import { DATE_FORMATS, formatDate, formatDateRange, formatUnreadableRange, parseYmd } from '@/utils/date'
import { getChartGranularity } from '@/utils/chartGranularity'
import { crossesCalendarYear } from '@/utils/chartYearAxis'
import { getCustomRangeDays } from './range'

/**
 * Finds the bar the pointer is over, or nothing when the chart reports no active bar
 */
export function getCashFlowTooltipBucket(state: RechartsTooltipState<CashFlowBarBucket>, buckets: CashFlowBarBucket[]) {
  return getRechartsTooltipPoint({
    state,
    data: buckets,
    // The chart's category is rangeLabel, since the axis label repeats across years
    resolveLabel: (label) => buckets.find((bucket) => bucket.rangeLabel === label),
  })
}

/**
 * Turns the cash flow response into labelled bars, choosing daily, weekly, or monthly buckets from
 * the length of the selected range and adding the net of each bucket
 *
 * Every bucket also carries a longer range label naming the days it covers, which the tooltip
 * shows because a bar labelled only "Mar" does not say where the period starts and ends.
 * A bucket whose dates cannot be read falls back to the raw dates from the backend rather than
 * being dropped from the chart
 */
export function getCashFlowBarData(response: InsightsCashFlowResponse | undefined, fromDate: string, toDate: string) {
  const dayCount = getCustomRangeDays(fromDate, toDate) ?? 1
  const granularity = getChartGranularity(dayCount)
  // A range that crosses a calendar year repeats months and days, so its tooltips name the year and its
  // axis marks where the year turns, with the year on the January label alone
  const showYear = crossesCalendarYear(fromDate, toDate)
  const dayFormat = showYear ? DATE_FORMATS.monthDayYear : DATE_FORMATS.monthDay
  const points = response?.points ?? []
  return {
    granularity,
    buckets: points.map(([bucketStart, bucketEnd, inflow, outflow], index): CashFlowBarBucket => {
      const firstDate = parseYmd(bucketStart)
      const lastDate = parseYmd(bucketEnd)
      // Monthly bars turn the year at each January. Weekly and daily bars have no January bar, so the first
      // bar of a new year does
      const marksYear =
        showYear &&
        firstDate !== null &&
        (granularity === 'month'
          ? firstDate.getMonth() === 0
          : index > 0 && points[index - 1][0].slice(0, 4) !== bucketStart.slice(0, 4))
      // Weekly bars are labelled by the day their week starts, since a week number is hard to place and
      // several weeks of one month would repeat its name. The tooltip's range gives each bar's dates
      const label =
        granularity === 'month'
          ? firstDate
            ? formatDate(firstDate, marksYear ? DATE_FORMATS.monthYear : DATE_FORMATS.month)
            : bucketStart
          : firstDate
            ? formatDate(firstDate, marksYear ? DATE_FORMATS.monthDayYear : DATE_FORMATS.monthDay)
            : bucketStart
      const rangeLabel =
        firstDate && lastDate && firstDate.getTime() === lastDate.getTime()
          ? formatDate(firstDate, dayFormat)
          : firstDate && lastDate
            ? formatDateRange(firstDate, lastDate, dayFormat)
            : formatUnreadableRange(bucketStart, bucketEnd)

      return {
        label,
        rangeLabel,
        marksYear,
        inflow,
        outflow,
        net: inflow - outflow,
      }
    }),
  }
}
