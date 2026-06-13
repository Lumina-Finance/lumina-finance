/**
 * Parses a date-only string as browser-local midnight to avoid UTC shifts in list labels
 */
export function parseYmdLocal(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/**
 * Formats the compact label shown in the transaction date-range filter chip
 */
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

/**
 * Formats the full overview range label while treating YYYY-MM-DD inputs as calendar dates
 */
export function formatOverviewRangeLabel(from: string, to: string): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const parse = (value: string) => new Date(`${value}T00:00:00Z`)
  return `${fmt.format(parse(from))} – ${fmt.format(parse(to))}`
}

export type CurrentMonthOverviewRange = {
  monthStart: string
  today: string
}

/**
 * Returns the current month range in the user's configured timezone for transaction overview metrics
 */
export function getCurrentMonthOverviewRange(
  timeZone: string,
  now = new Date(),
): CurrentMonthOverviewRange {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  })
  const today = fmt.format(now)
  const monthStart = `${today.slice(0, 7)}-01`
  return { monthStart, today }
}
