// Every date the product renders goes through this locale, so a browser configured for another
// region still sees one convention. Every format below names the month rather than numbering it,
// where this renders identically to en-US, so this constant is about having one place to change
// the convention rather than about changing today's output
const DATE_LOCALE = 'en-CA'

const DAYS_PER_WEEK = 7

// The shape the API sends and expects: a zero-padded ISO 8601 calendar date, and nothing looser,
// so a string carrying a time or a missing pad is refused rather than half-read
const YMD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * The date formats the product renders, so a call site names the format it wants instead of
 * respelling the options
 */
export const DATE_FORMATS = {
  month: { month: 'short' },
  monthDay: { month: 'short', day: 'numeric' },
  monthYear: { month: 'short', year: 'numeric' },
  monthDayYear: { month: 'short', day: 'numeric', year: 'numeric' },
  longMonthYear: { month: 'long', year: 'numeric' },
  longDate: { year: 'numeric', month: 'long', day: 'numeric' },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>

export type DateFormat = (typeof DATE_FORMATS)[keyof typeof DATE_FORMATS]

// A zone is remembered alongside the zone it resolved to, so one the browser rejects is not
// re-tested on every render
const resolvedTimeZones = new Map<string, string>()

/**
 * Returns the timezone the browser is running in
 *
 * Sign-up reads this directly, having no profile yet to take a zone from. Anywhere a user exists,
 * the profile setting is passed to resolveTimeZone or to one of the getToday helpers instead
 */
export function getBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * Returns a timezone the browser can format with, falling back to its own zone when the given one
 * is missing or unrecognized
 *
 * A zone stored on the profile can outlive the browser that chose it, and Intl throws from the
 * constructor rather than degrading, which would otherwise unmount the whole app
 *
 * @param timeZone - IANA zone name, typically the profile setting
 * @returns A zone name that is safe to hand to Intl
 */
export function resolveTimeZone(timeZone?: string | null): string {
  if (!timeZone) return getBrowserTimeZone()

  const resolved = resolvedTimeZones.get(timeZone)
  if (resolved) return resolved

  try {
    new Intl.DateTimeFormat(DATE_LOCALE, { timeZone })
    resolvedTimeZones.set(timeZone, timeZone)
    return timeZone
  } catch {
    const fallback = getBrowserTimeZone()
    resolvedTimeZones.set(timeZone, fallback)
    return fallback
  }
}

/**
 * Renders a date in the product's locale
 *
 * @param date - The date to render
 * @param format - One of DATE_FORMATS
 * @param timeZone - Zone to read the date in, defaulting to the browser's. Pass this only for a
 * real timestamp: a date built from calendar parts already names the day intended, and reading it
 * in another zone shifts it
 */
export function formatDate(date: Date, format: DateFormat, timeZone?: string): string {
  return new Intl.DateTimeFormat(DATE_LOCALE, {
    ...format,
    timeZone: resolveTimeZone(timeZone),
  }).format(date)
}

/**
 * Returns today's calendar day in the given zone as a "YYYY-MM-DD" string
 *
 * The parts are read out individually rather than formatted into a string, so the result does not
 * depend on the locale putting the year first
 *
 * @param timeZone - Zone deciding which day it currently is, defaulting to the browser's
 * @param now - Instant to read the day from, overridable so tests can pin it
 */
export function getTodayYmd(timeZone?: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat(DATE_LOCALE, {
    timeZone: resolveTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''

  return `${part('year')}-${part('month')}-${part('day')}`
}

/**
 * Returns today's calendar day in the given zone, as a date at browser-local midnight
 *
 * Callers step through days and months with the local getters, so the day the user is on has to be
 * expressed on the browser's own calendar for that arithmetic to land on the right date
 *
 * @param timeZone - Zone deciding which day it currently is, defaulting to the browser's
 * @param now - Instant to read the day from, overridable so tests can pin it
 */
export function getTodayDate(timeZone?: string, now = new Date()): Date {
  const [year, month, day] = getTodayYmd(timeZone, now).split('-').map(Number)

  return new Date(year, month - 1, day)
}

/**
 * Returns the calendar year it currently is in the given zone
 *
 * @param timeZone - Zone deciding which year it currently is, defaulting to the browser's
 * @param now - Instant to read the year from, overridable so tests can pin it
 */
export function getTodayYear(timeZone?: string, now = new Date()): number {
  return Number(getTodayYmd(timeZone, now).slice(0, 4))
}

/**
 * Writes the date as a zero-padded "YYYY-MM-DD" string, the form the API expects
 *
 * The parts are read off the local calendar rather than converted to UTC, so the string names the
 * day the user is looking at instead of shifting by a day near midnight
 */
export function formatYmd(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
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
 *
 * Anything asking whether a string names a real day calls this and tests the result for null,
 * rather than repeating the reasoning below
 */
export function parseYmd(ymd: string): Date | null {
  const match = YMD_PATTERN.exec(ymd)
  if (!match) return null

  const [year, month, day] = match.slice(1).map(Number)
  const parsed = new Date(year, month - 1, day)
  // An overflowed part rolls forward instead of failing, so February 31 arrives as March 3 unless
  // the parts are read back and compared against what was asked for
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    return null
  }

  return parsed
}

/**
 * Reads a "YYYY-MM-DD" string into a time value that can be ordered arithmetically
 *
 * Sorting reads each date once into a number rather than comparing the strings, which would follow
 * the browser's language rules and could order the same dates differently on a user's other device
 *
 * A string that is not a real calendar day means whatever produced it broke the shape the API
 * promises, so this stops rather than ordering an unreadable value to one end where it would go
 * unnoticed
 *
 * @throws When the string is not a zero-padded ISO calendar date
 */
export function getYmdTime(ymd: string): number {
  const parsed = parseYmd(ymd)
  if (parsed === null) throw new Error(`Expected a YYYY-MM-DD date, received "${ymd}"`)

  return parsed.getTime()
}

/**
 * Returns a new date the given number of days later, or earlier for a negative count, leaving the
 * date passed in unchanged
 */
export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)

  return next
}

/**
 * Adds (or subtracts) whole months, clamping the day so stepping back from a month end never
 * overflows into the following month, for example Mar 31 minus one month is Feb 28
 */
export function addMonths(date: Date, months: number): Date {
  const next = new Date(date)
  const targetDay = next.getDate()
  next.setDate(1)
  next.setMonth(next.getMonth() + months)
  const lastDayOfResultMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
  next.setDate(Math.min(targetDay, lastDayOfResultMonth))

  return next
}

/**
 * Returns the day of the week with Monday as zero
 *
 * Weeks run Monday to Sunday everywhere in the product, matching the backend's use of Python's
 * weekday(). Anything laying out or bucketing a week reads its offset from here so the two cannot
 * drift apart again
 */
export function getWeekdayIndex(date: Date): number {
  // getDay reports 0 for Sunday, so shift it to the end of the week to make Monday day zero
  return (date.getDay() + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK
}

/**
 * Returns the Monday that starts the week containing the given date
 */
export function getStartOfWeek(date: Date): Date {
  return addDays(date, -getWeekdayIndex(date))
}

/**
 * Returns the ISO week number of the date, where weeks run Monday to Sunday and week one is the
 * week holding the first Thursday of the year
 *
 * The calculation runs against UTC copies of the date so a daylight saving change part way
 * through the year cannot push a date into the neighbouring week
 */
export function getIsoWeek(date: Date): number {
  const normalized = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  normalized.setUTCDate(normalized.getUTCDate() + 4 - (normalized.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(normalized.getUTCFullYear(), 0, 1))

  return Math.ceil((((normalized.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}
