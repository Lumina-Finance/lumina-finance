import { DATE_FORMATS, formatDate, getTodayYmd } from '@/utils/date'

/**
 * Parses a date-only string as browser-local midnight to avoid UTC shifts in list labels
 */
export function parseYmdLocal(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/**
 * Formats the full overview range label while treating YYYY-MM-DD inputs as calendar dates
 */
export function formatOverviewRangeLabel(from: string, to: string): string {
  // Reading the day back in UTC after parsing it as UTC midnight keeps the label on the day the
  // string names, whatever zone the browser is in
  const label = (value: string) =>
    formatDate(new Date(`${value}T00:00:00Z`), DATE_FORMATS.monthDayYear, 'UTC')
  return `${label(from)} – ${label(to)}`
}

export type CurrentMonthOverviewRange = {
  monthStart: string
  today: string
}

/**
 * Returns the current month range in the user's configured timezone for transaction overview metrics
 */
export function getCurrentMonthOverviewRange(
  timeZone: string,
  now = new Date(),
): CurrentMonthOverviewRange {
  const today = getTodayYmd(timeZone, now)
  const monthStart = `${today.slice(0, 7)}-01`
  return { monthStart, today }
}
