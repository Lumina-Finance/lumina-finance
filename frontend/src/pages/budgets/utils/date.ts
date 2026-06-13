import type { CalendarDate } from '@/pages/budgets/types'

/**
 * Formats today's calendar day in the user's configured timezone for date inputs
 */
export function todayYmd(timeZone: string) {

  // Format parts avoid UTC conversion changing the user's local calendar day
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/**
 * Parses a backend YYYY-MM-DD value into a plain calendar date
 */
export function parseYmd(ymd: string): CalendarDate {
  const [year, month, day] = ymd.split('-').map(Number)
  return { year, month, day }
}

/**
 * Formats a plain calendar date for short labels in budget UI
 */
export function formatCalendarDate(date: CalendarDate) {
  return new Date(date.year, date.month - 1, date.day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
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
