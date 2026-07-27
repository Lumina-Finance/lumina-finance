/**
 * Reads the calendar day a browser-local date falls on and returns it as UTC midnight, so chart
 * positions and ticks depend only on the day and not on the reader's offset from UTC
 */
export function calendarDateMs(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
}
