// Parse a date-only string as browser-local midnight. This is not timezone-aware;
// it just avoids the UTC interpretation that new Date("YYYY-MM-DD") applies.
export function parseYmdLocal(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Compact label for the date-range filter chip. Drops the duplicate year when
// both bounds fall in the same year.
export function formatDateRangeLabel(from?: string, to?: string): string | null {
  if (!from && !to) return null
  const monthDay = (ymd: string) => parseYmdLocal(ymd).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
  const fullYear = (ymd: string) => parseYmdLocal(ymd).getFullYear()
  const shortYear = (ymd: string) => `'${ymd.slice(2, 4)}`

  if (from && to) {
    if (fullYear(from) === fullYear(to)) {
      return `${monthDay(from)} – ${monthDay(to)}, ${fullYear(to)}`
    }
    return `${monthDay(from)}, ${shortYear(from)} – ${monthDay(to)}, ${shortYear(to)}`
  }
  if (from) return `From ${monthDay(from)}, ${fullYear(from)}`
  return `Until ${monthDay(to!)}, ${fullYear(to!)}`
}
