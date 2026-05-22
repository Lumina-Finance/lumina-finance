import type { InsightsNetWorthResponse } from '@/api/insights'
import { parseYmd } from './date'
import type { NetWorthGroup, NetWorthPoint } from './netWorthChart'
import { getCustomRangeDays } from './range'

export type { NetWorthGroup, NetWorthPoint, NetWorthViewMode } from './netWorthChart'

type NetWorthGranularity = 'day' | 'week' | 'month'

function getNetWorthGranularity(dayCount: number): NetWorthGranularity {
  if (dayCount <= 30) return 'day'
  if (dayCount <= 90) return 'week'
  return 'month'
}

export function getNetWorthCardData(
  response: InsightsNetWorthResponse | undefined,
  fromDate: string,
  toDate: string,
): { groups: NetWorthGroup[]; series: NetWorthPoint[] } {
  if (!response) return { groups: [], series: [] }

  const groups = response.groups ?? []
  const points = response.points ?? []
  const dayCount = getCustomRangeDays(fromDate, toDate) ?? 1
  const granularity = getNetWorthGranularity(dayCount)
  return {
    groups: groups.map(([id, name, kind]) => ({ id, name, kind })),
    series: points.map(([labelDate, valueDate, values]) => {
      const label = parseYmd(labelDate)
      const tooltip = parseYmd(valueDate)
      return {
        date: labelDate,
        dateLabel: label
          ? label.toLocaleDateString('en-US', {
              month: 'short',
              day: granularity === 'month' ? undefined : 'numeric',
            })
          : labelDate,
        tooltipLabel: tooltip
          ? tooltip.toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })
          : valueDate,
        total: values.reduce((sum, value) => sum + value, 0),
        values,
      }
    }),
  }
}
