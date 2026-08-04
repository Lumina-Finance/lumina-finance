import { DATE_FORMATS, formatDate, parseYmd } from '@/utils/date'

/**
 * Formats a backend YYYY-MM-DD value for compact dashboard labels, falling back to the value itself
 * when it is not a real date, so the row keeps its amount rather than disappearing
 */
export function formatDashboardShortDate(value: string) {
  const parsed = parseYmd(value)
  if (!parsed) return value

  return formatDate(parsed, DATE_FORMATS.monthDay)
}
