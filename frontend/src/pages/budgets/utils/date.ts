import type { CalendarDate } from '@/pages/budgets/types'
import { DATE_FORMATS, formatDate, parseYmd } from '@/utils/date'

/**
 * Parses a backend YYYY-MM-DD value into a plain calendar date, returning null when it is not a
 * real date
 *
 * The check runs through the shared parse so there is one definition of a day the calendar has, and
 * so an impossible stored value cannot reach the period arithmetic below and step forward from a day
 * that was silently rolled into the next month
 */
export function parseCalendarDate(ymd: string): CalendarDate | null {
  const parsed = parseYmd(ymd)
  if (!parsed) return null

  return { year: parsed.getFullYear(), month: parsed.getMonth() + 1, day: parsed.getDate() }
}

/**
 * Formats a plain calendar date for short labels in budget UI
 */
export function formatCalendarDate(date: CalendarDate) {
  return formatDate(new Date(date.year, date.month - 1, date.day), DATE_FORMATS.monthDayYear)
}

/**
 * Adds whole calendar days without preserving any time component
 */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  const result = new Date(date.year, date.month - 1, date.day + days)
  return {
    year: result.getFullYear(),
    month: result.getMonth() + 1,
    day: result.getDate(),
  }
}

/**
 * Clamps a requested day to the last valid day of the target month
 */
export function anchorDay(year: number, month: number, day: number) {
  return Math.min(day, new Date(year, month, 0).getDate())
}

/**
 * Adds whole calendar months while preserving end-of-month anchors
 */
export function addMonths(date: CalendarDate, months: number): CalendarDate {
  const totalMonths = date.year * 12 + (date.month - 1) + months
  const year = Math.floor(totalMonths / 12)
  const month = totalMonths % 12 + 1
  return { year, month, day: anchorDay(year, month, date.day) }
}
