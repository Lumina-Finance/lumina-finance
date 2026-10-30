import type { InsightsNetWorthResponse } from '@/api/insights'
import { DATE_FORMATS, formatDate, parseYmd } from '@/utils/date'
import type { NetWorthGroup, NetWorthPoint } from './netWorthChart'
import { getChartGranularity } from '@/utils/chartGranularity'
import { crossesCalendarYear } from '@/utils/chartYearAxis'
import { getCustomRangeDays } from './range'

export type { NetWorthGroup, NetWorthPoint, NetWorthViewMode } from './netWorthChart'

/**
 * Builds the net worth card's groups, baseline, and chart series from the raw response, choosing
 * a day, week, or month date label granularity based on how many days the range spans
 */
export function getNetWorthCardData(
  response: InsightsNetWorthResponse | undefined,
  fromDate: string,
  toDate: string,
): { groups: NetWorthGroup[]; baseline: number[]; series: NetWorthPoint[] } {
  if (!response) return { groups: [], baseline: [], series: [] }

  const groups = response.groups ?? []
  const points = response.points ?? []
  const dayCount = getCustomRangeDays(fromDate, toDate) ?? 1
  const granularity = getChartGranularity(dayCount)
  // A monthly range over two calendar years repeats months, so the January labels name their year
  const showYear = granularity === 'month' && crossesCalendarYear(fromDate, toDate)
  return {
    groups: groups.map(([id, name, kind]) => ({ id, name, kind })),
    baseline: response.baseline ?? [],
    series: points.map(([labelDate, valueDate, values]) => {
      const label = parseYmd(labelDate)
      const tooltip = parseYmd(valueDate)
      const marksYear = showYear && label !== null && label.getMonth() === 0
      return {
        date: labelDate,
        dateLabel: label
          ? formatDate(
              label,
              granularity === 'month'
                ? marksYear
                  ? DATE_FORMATS.monthYear
                  : DATE_FORMATS.month
                : DATE_FORMATS.monthDay,
            )
          : labelDate,
        marksYear,
        tooltipLabel: tooltip ? formatDate(tooltip, DATE_FORMATS.monthDayYear) : valueDate,
        total: values.reduce((sum, value) => sum + value, 0),
        values,
      }
    }),
  }
}
