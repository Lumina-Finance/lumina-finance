import { parseYmd } from '@/utils/date'

/**
 * Splits items into those dated after today and the rest, keeping each side in its original order
 *
 * A date the calendar doesn't have stays with the rest, where lists already show it under its raw value
 * rather than guessing which side of today it falls on
 *
 * @param items - The items to split
 * @param getYmd - Reads an item's "YYYY-MM-DD" date
 * @param today - Today as "YYYY-MM-DD" in the user's profile timezone
 */
export function splitUpcoming<T>(
  items: T[],
  getYmd: (item: T) => string,
  today: string,
): { upcoming: T[]; rest: T[] } {
  const upcoming: T[] = []
  const rest: T[] = []
  for (const item of items) {
    const ymd = getYmd(item)

    // Zero-padded ISO dates order the same way as strings, and parseYmd has confirmed the shape
    if (parseYmd(ymd) !== null && ymd > today) {
      upcoming.push(item)
    } else {
      rest.push(item)
    }
  }
  return { upcoming, rest }
}
