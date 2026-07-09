// A leap year stands in for the day clamp while the real year is still being typed, so February can
// briefly hold 29 rather than snapping to 28 before the user finishes the year
const LEAP_REFERENCE_YEAR = 2000

const YEAR_LENGTH = 4
const MONTH_MAX = 12

// The most digits each segment holds, also the point at which typing rolls over to the next segment
export const SEGMENT_MAX_LENGTH = { year: YEAR_LENGTH, month: 2, day: 2 } as const

export type DateSegmentName = 'year' | 'month' | 'day'

/**
 * Raw digit strings for each segment while editing, empty when a segment has not been filled
 */
export interface DateSegments {
  year: string
  month: string
  day: string
}

export const EMPTY_SEGMENTS: DateSegments = { year: '', month: '', day: '' }

// Focus and auto-advance move through the segments in this order
export const SEGMENT_ORDER: DateSegmentName[] = ['year', 'month', 'day']

/**
 * Returns the number of days in the given month, using a leap year when the year is not yet known so
 * February stays at 29 until the real year clamps it
 */
export function getDaysInMonth(year: number | null, month: number): number {
  const resolvedYear = year ?? LEAP_REFERENCE_YEAR

  return new Date(resolvedYear, month, 0).getDate()
}

/**
 * Pads a numeric string to two characters for month and day display
 */
function padTwo(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Reads a segment string as an integer, or null when it is empty
 */
function toInt(segment: string): number | null {
  return segment === '' ? null : Number.parseInt(segment, 10)
}

/**
 * Clamps the month and day segments to a representable date so an impossible combination such as
 * February 31 can never be shown, dropping the day to the month's last valid day when it overflows
 */
function clampSegments(segments: DateSegments): DateSegments {
  let { month, day } = segments

  // A completed month is held within January to December
  if (month.length === 2) {
    const monthValue = Number.parseInt(month, 10)
    month = padTwo(Math.min(Math.max(monthValue, 1), MONTH_MAX))
  }

  const monthValue = toInt(month)
  const dayValue = toInt(day)
  if (monthValue && dayValue) {
    const maxDay = getDaysInMonth(segments.year.length === YEAR_LENGTH ? toInt(segments.year) : null, monthValue)
    if (dayValue > maxDay) day = padTwo(maxDay)
  }

  return { year: segments.year, month, day }
}

/**
 * Applies newly typed digits to a segment, keeping only digits, capping the length, and re-clamping
 * the date so the visible value is always a real calendar date
 */
export function setSegmentDigits(
  segments: DateSegments,
  segment: DateSegmentName,
  rawValue: string,
): DateSegments {
  const digits = rawValue.replace(/\D/g, '').slice(0, SEGMENT_MAX_LENGTH[segment])

  return clampSegments({ ...segments, [segment]: digits })
}

/**
 * Reports whether a segment is full enough to move focus to the next segment, advancing early when a
 * single digit can no longer be the start of a two digit value
 */
export function shouldAdvanceSegment(segment: DateSegmentName, digits: string): boolean {
  if (digits.length >= SEGMENT_MAX_LENGTH[segment]) return true

  if (segment === 'month') return digits.length === 1 && Number.parseInt(digits, 10) >= 2

  if (segment === 'day') return digits.length === 1 && Number.parseInt(digits, 10) >= 4

  return false
}

/**
 * Steps a segment up or down for arrow key edits, wrapping month and day around their range while an
 * empty segment seeds to today's value on the first press so it lands on a sensible starting point
 */
export function stepSegment(
  segments: DateSegments,
  segment: DateSegmentName,
  delta: number,
  today: Date,
): DateSegments {
  if (segment === 'year') {
    const current = toInt(segments.year)
    const next = current === null ? today.getFullYear() : Math.min(Math.max(current + delta, 1), 9999)
    return clampSegments({ ...segments, year: String(next) })
  }

  if (segment === 'month') {
    const current = toInt(segments.month)
    const next = current === null ? today.getMonth() + 1 : ((current - 1 + delta + MONTH_MAX) % MONTH_MAX) + 1
    return clampSegments({ ...segments, month: padTwo(next) })
  }

  const monthValue = toInt(segments.month) ?? today.getMonth() + 1
  const maxDay = getDaysInMonth(segments.year.length === YEAR_LENGTH ? toInt(segments.year) : null, monthValue)
  const current = toInt(segments.day)
  const next = current === null ? Math.min(today.getDate(), maxDay) : ((current - 1 + delta + maxDay) % maxDay) + 1
  return { ...segments, day: padTwo(next) }
}

/**
 * Parses an ISO yyyy-mm-dd string into segments, returning empty segments for any other input
 */
export function parseIsoDate(value: string): DateSegments {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return EMPTY_SEGMENTS

  return { year: match[1], month: match[2], day: match[3] }
}

/**
 * Formats complete, valid segments as an ISO yyyy-mm-dd string, or an empty string while the date is
 * still incomplete so partial editing never emits a bogus value
 */
export function formatIsoDate(segments: DateSegments): string {
  const year = segments.year
  const month = toInt(segments.month)
  const day = toInt(segments.day)
  if (year.length !== YEAR_LENGTH || !month || !day) return ''

  if (month < 1 || month > MONTH_MAX) return ''
  if (day < 1 || day > getDaysInMonth(Number.parseInt(year, 10), month)) return ''

  return `${year}-${padTwo(month)}-${padTwo(day)}`
}
