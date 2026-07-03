const RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['week', 60 * 60 * 24 * 7],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
]

const JUST_NOW_THRESHOLD_SECONDS = 45

/**
 * Formats a past ISO-8601 timestamp as a short relative phrase such as "2 days ago" or "just now",
 * picking the largest unit that fits. Recomputes only when the caller re-renders, which is fine for a
 * coarse label that never needs to tick live
 */
export function formatRelativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < JUST_NOW_THRESHOLD_SECONDS) return 'just now'

  for (const [unit, unitSeconds] of RELATIVE_UNITS) {
    if (seconds >= unitSeconds) {
      return RELATIVE_TIME_FORMAT.format(-Math.round(seconds / unitSeconds), unit)
    }
  }

  return 'just now'
}
