import type { InsightsCashFlowResponse } from '@/api/insights'
import type { CashFlowBarBucket, CashFlowGranularity } from '@/pages/insights/types/cashFlow'
import { DATE_FORMATS, formatDate, getIsoWeek, parseYmd } from '@/utils/date'
import { getCustomRangeDays } from './range'

function getCashFlowGranularity(dayCount: number): CashFlowGranularity {
  if (dayCount <= 31) return 'day'
  if (dayCount <= 90) return 'week'
  return 'month'
}

/**
 * Turns the cash flow response into labelled bars, choosing daily, weekly, or monthly buckets from
 * the length of the selected range and adding the net of each bucket
 *
 * Every bucket also carries a longer range label naming the days it covers, which the tooltip
 * shows because a bar labelled only "W12" or "Mar" does not say where the period starts and ends.
 * A bucket whose dates cannot be read falls back to the raw dates from the backend rather than
 * being dropped from the chart
 */
export function getCashFlowBarData(
  response: InsightsCashFlowResponse | undefined,
  fromDate: string,
  toDate: string,
) {
  const dayCount = getCustomRangeDays(fromDate, toDate) ?? 1
  const granularity = getCashFlowGranularity(dayCount)
  return {
    granularity,
    buckets: (response?.points ?? []).map(([bucketStart, bucketEnd, inflow, outflow]): CashFlowBarBucket => {
      const firstDate = parseYmd(bucketStart)
      const lastDate = parseYmd(bucketEnd)
      const label = granularity === 'day'
        ? (firstDate ? formatDate(firstDate, DATE_FORMATS.monthDay) : bucketStart)
        : granularity === 'week'
          ? firstDate ? `W${getIsoWeek(firstDate)}` : bucketStart
          : firstDate ? formatDate(firstDate, DATE_FORMATS.month) : bucketStart
      const rangeLabel = firstDate && lastDate && firstDate.getTime() === lastDate.getTime()
        ? formatDate(firstDate, DATE_FORMATS.monthDay)
        : firstDate && lastDate
          ? `${formatDate(firstDate, DATE_FORMATS.monthDay)}-${formatDate(lastDate, DATE_FORMATS.monthDay)}`
          : `${bucketStart}-${bucketEnd}`

      return {
        label,
        rangeLabel,
        inflow,
        outflow,
        net: inflow - outflow,
      }
    }),
  }
}
