import type { NetWorthWidgetResponse } from '@/api/dashboard'
import type { NetWorthSeriesPoint } from '@/dashboard/types/dashboard'

/**
 * Adds display dates to the trailing net-worth history returned by the API
 * The backend returns only ordered values, so labels are derived from today
 */
export function getNetWorthSeries(
  dashboardNetWorth: NetWorthWidgetResponse | undefined,
): NetWorthSeriesPoint[] {
  const history = dashboardNetWorth?.net_worth_history ?? []
  if (history.length === 0) return []

  // The backend returns a trailing daily value array without labels. Recreate
  // the matching date labels client-side from today backward
  const today = new Date()
  return history.map((value, i) => {
    const date = new Date(today)
    date.setDate(today.getDate() - (history.length - 1 - i))

    return {
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      value,
    }
  })
}
