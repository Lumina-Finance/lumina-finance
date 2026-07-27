import type { NetWorthWidgetResponse } from '@/api/dashboard'
import type { NetWorthSeriesPoint } from '@/pages/dashboard/types/dashboard'
import { DATE_FORMATS, addDays, formatDate, getTodayDate } from '@/utils/date'

/**
 * Adds display dates to the trailing net-worth history returned by the API
 * The backend returns only ordered values, so labels are derived from today
 *
 * @param dashboardNetWorth - The widget response holding the unlabelled history
 * @param timeZone - Zone deciding which day the history ends on, defaulting to the browser's. The
 * backend counts back from the user's own today, so reading it in another zone shifts every label
 */
export function getNetWorthSeries(
  dashboardNetWorth: NetWorthWidgetResponse | undefined,
  timeZone?: string,
): NetWorthSeriesPoint[] {
  const history = dashboardNetWorth?.net_worth_history ?? []
  if (history.length === 0) return []

  // The backend returns a trailing daily value array without labels. Recreate
  // the matching date labels client-side from today backward
  const today = getTodayDate(timeZone)
  return history.map((value, i) => ({
    date: formatDate(addDays(today, -(history.length - 1 - i)), DATE_FORMATS.monthDay),
    value,
  }))
}
