/**
 * Writes the date as a zero-padded "YYYY-MM-DD" string, the form the insights endpoints expect
 *
 * The parts are read off the local calendar rather than converted to UTC, so the string names the
 * day the user is looking at instead of shifting by a day near midnight
 */
export function formatYmd(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Reads a "YYYY-MM-DD" string back into a date at local midnight, returning null when the string
 * does not name a real calendar day
 *
 * Building the date from its parts rather than letting the browser parse the string keeps it on
 * the local calendar, since a bare date string is otherwise read as UTC and can land on the
 * previous day west of Greenwich
 */
export function parseYmd(ymd: string) {
  const [year, month, day] = ymd.split('-').map(Number)
  const parsed = new Date(year, month - 1, day)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Returns a new date the given number of days later, or earlier for a negative count, leaving the
 * date passed in unchanged
 */
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

/**
 * Returns a compact month and day label for the date, such as "Jan 5", with the year left off
 * because insight ranges carry their own year context
 */
export function getShortDateLabel(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Returns the abbreviated month name of the date, such as "Jan", for chart axes grouped by month
 */
export function getMonthLabel(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short' })
}

/**
 * Returns the ISO week number of the date, where weeks run Monday to Sunday and week one is the
 * week holding the first Thursday of the year
 *
 * The calculation runs against UTC copies of the date so a daylight saving change part way
 * through the year cannot push a date into the neighbouring week
 */
export function getIsoWeek(date: Date) {
  const normalized = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  normalized.setUTCDate(normalized.getUTCDate() + 4 - (normalized.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(normalized.getUTCFullYear(), 0, 1))
  return Math.ceil((((normalized.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}
