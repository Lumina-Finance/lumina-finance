import { DATE_FORMATS, formatDate } from '@/utils/date'

/**
 * Formats backend YYYY-MM-DD or ISO date strings for compact dashboard labels
 */
export function formatDashboardShortDate(value: string) {
  const [datePart] = value.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  if (!year || !month || !day) return 'Unknown'

  return formatDate(new Date(year, month - 1, day), DATE_FORMATS.monthDay)
}
