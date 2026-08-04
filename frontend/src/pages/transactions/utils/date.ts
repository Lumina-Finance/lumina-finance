import { DATE_FORMATS, formatDate, parseYmd, getTodayYmd } from '@/utils/date'

/**
 * Formats the full overview range label while treating YYYY-MM-DD inputs as calendar dates
 *
 * An end of the range that is not a real date keeps its raw string, so the label states what it was
 * given rather than the day the date constructor would have rolled it forward to
 */
export function formatOverviewRangeLabel(from: string, to: string): string {
  const label = (value: string) => {
    const date = parseYmd(value)
    return date ? formatDate(date, DATE_FORMATS.monthDayYear) : value
  }
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
