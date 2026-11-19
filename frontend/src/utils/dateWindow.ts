import { formatDateLabel } from '@/utils/date'

// The window every date the app takes must sit in, matching the server's: from this day to ten
// years after today. The server counts ten years from the furthest-ahead calendar, so a date this
// refuses is always one the server refuses too
export const EARLIEST_ALLOWED_YMD = '1900-01-01'
export const ALLOWED_YEARS_AHEAD = 10

// The longest span a report covers
export const MAX_RANGE_YEARS = 20

export const RANGE_TOO_LONG_MESSAGE = `Can cover at most ${MAX_RANGE_YEARS} years`

const YMD_PARTS_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Returns the day a whole number of years after a "YYYY-MM-DD" day, landing 29 February on 28 February
 *
 * Works on the text rather than a Date, since a Date reads years before 100 as 19xx
 */
function addYearsYmd(ymd: string, years: number): string | null {
  const match = YMD_PARTS_PATTERN.exec(ymd)
  if (!match) return null

  const year = Number(match[1]) + years
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const day = match[2] === '02' && match[3] === '29' && !isLeapYear ? '28' : match[3]

  return `${String(year).padStart(4, '0')}-${match[2]}-${day}`
}

/**
 * Returns the last day inside the window, ten years after today, or null for a today that is not a date
 *
 * @param todayYmd - Today in the user's own zone
 */
export function getLatestAllowedYmd(todayYmd: string): string | null {
  return addYearsYmd(todayYmd, ALLOWED_YEARS_AHEAD)
}

/**
 * Says why a day is outside the window, or returns null for a day inside it and for text that is not
 * yet a whole date. The field's own checks answer for that text
 *
 * @param ymd - The day as "YYYY-MM-DD"
 * @param todayYmd - Today in the user's own zone
 */
export function getDateWindowError(ymd: string, todayYmd: string): string | null {
  if (!YMD_PARTS_PATTERN.test(ymd)) return null
  // The date is kept on one line, so a narrow field's label row wraps before it rather than inside it
  if (ymd < EARLIEST_ALLOWED_YMD) {
    return `Must be on or after ${formatDateLabel(EARLIEST_ALLOWED_YMD).replaceAll(' ', ' ')}`
  }

  const latest = getLatestAllowedYmd(todayYmd)
  if (latest !== null && ymd > latest) return 'Must be within ten years of today'

  return null
}

/**
 * Says when a range covers more than 20 years, or returns null for one that does not and for ends
 * that are not yet whole dates
 *
 * @param from - First day as "YYYY-MM-DD"
 * @param to - Last day as "YYYY-MM-DD"
 */
export function getRangeSpanError(from: string, to: string): string | null {
  const limit = addYearsYmd(from, MAX_RANGE_YEARS)
  if (limit === null || !YMD_PARTS_PATTERN.test(to)) return null

  return to >= limit ? RANGE_TOO_LONG_MESSAGE : null
}
