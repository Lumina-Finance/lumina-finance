/**
 * Parses a date-only string as browser-local midnight to avoid UTC shifts in list labels
 */
export function parseYmdLocal(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
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
