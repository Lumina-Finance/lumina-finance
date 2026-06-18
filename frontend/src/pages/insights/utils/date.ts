export function formatYmd(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseYmd(ymd: string) {
  const [year, month, day] = ymd.split('-').map(Number)
  const parsed = new Date(year, month - 1, day)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/**
 * Returns the Monday that starts the ISO week containing the given date
 */
export function getStartOfWeek(date: Date) {
  // getDay reports 0 for Sunday, so shift it to the end of the week to make Monday day zero
  const daysFromMonday = (date.getDay() + 6) % 7
  return addDays(date, -daysFromMonday)
}

/**
 * Adds (or subtracts) whole months, clamping the day so stepping back from a month end
 * never overflows into the following month, for example Mar 31 minus one month is Feb 28
 */
export function addMonths(date: Date, months: number) {
  const next = new Date(date)
  const targetDay = next.getDate()
  next.setDate(1)
  next.setMonth(next.getMonth() + months)
  const lastDayOfResultMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
  next.setDate(Math.min(targetDay, lastDayOfResultMonth))
  return next
}

export function getShortDateLabel(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function getMonthLabel(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short' })
}

export function getIsoWeek(date: Date) {
  const normalized = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  normalized.setUTCDate(normalized.getUTCDate() + 4 - (normalized.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(normalized.getUTCFullYear(), 0, 1))
  return Math.ceil((((normalized.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}
