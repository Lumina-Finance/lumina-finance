import type {
  InsightsComparisonPeriod,
  SavedInsightsRangeQualifier,
  SavedInsightsRangeUnit,
} from '@/api/insights'
import type { InsightsRangeInputDates, InsightsRangePreset } from '../types/range'
import { addDays, formatYmd, getShortDateLabel, getStartOfWeek, parseYmd } from './date'

// How many months each calendar unit spans, which doubles as the alignment granularity used to
// roll a window start back to the first day of a whole month, quarter, or year
const MONTHS_PER_UNIT: Record<'month' | 'quarter' | 'year', number> = {
  month: 1,
  quarter: 3,
  year: 12,
}

function getFixedPresetBounds(preset: InsightsRangePreset): { start: Date; end: Date } {
  const today = new Date()

  switch (preset) {
    case 'THIS_MONTH':
      return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: today }
    case 'THIS_YEAR':
      return { start: new Date(today.getFullYear(), 0, 1), end: today }
    case 'LAST_MONTH': {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      return { start, end: new Date(today.getFullYear(), today.getMonth(), 0) }
    }
    case 'LAST_90_DAYS':
      return { start: addDays(today, -89), end: today }
    default:
      return { start: addDays(today, -29), end: today }
  }
}

/**
 * Returns the inclusive day count between two YYYY-MM-DD dates, or null when either date fails to
 * parse or the range is inverted
 */
export function getCustomRangeDays(from: string, to: string) {
  const fromDate = parseYmd(from)
  const toDate = parseYmd(to)
  if (!fromDate || !toDate || fromDate > toDate) return null
  return Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1)
}

/**
 * Resolves a fixed preset to the inclusive from/to dates its cards query
 */
export function getRangeInputDates(preset: InsightsRangePreset): InsightsRangeInputDates {
  const { start, end } = getFixedPresetBounds(preset)
  return { from: formatYmd(start), to: formatYmd(end) }
}

/**
 * Resolves a trailing "last N units" window ending today
 *
 * Day windows count the exact number of trailing days. Week, month, quarter, and year windows
 * align the start to the beginning of the earliest whole period they cover, so the window always
 * reaches back to a week, month, quarter, or year boundary
 */
function getTrailingRangeInputDates(
  amount: number,
  unit: SavedInsightsRangeUnit,
  today: Date,
): InsightsRangeInputDates {
  if (unit === 'day') {
    return { from: formatYmd(addDays(today, -(amount - 1))), to: formatYmd(today) }
  }
  if (unit === 'week') {
    const start = addDays(getStartOfWeek(today), -(amount - 1) * 7)
    return { from: formatYmd(start), to: formatYmd(today) }
  }

  const periodMonths = MONTHS_PER_UNIT[unit]
  const alignedStartMonth = Math.floor(today.getMonth() / periodMonths) * periodMonths - (amount - 1) * periodMonths
  return { from: formatYmd(new Date(today.getFullYear(), alignedStartMonth, 1)), to: formatYmd(today) }
}

/**
 * Resolves a window of the last N whole completed periods, ending the day before the current
 * period begins so the in-progress period is excluded
 */
function getCompleteRangeInputDates(
  amount: number,
  unit: SavedInsightsRangeUnit,
  today: Date,
): InsightsRangeInputDates {
  if (unit === 'day') {
    return { from: formatYmd(addDays(today, -amount)), to: formatYmd(addDays(today, -1)) }
  }
  if (unit === 'week') {
    const currentWeekStart = getStartOfWeek(today)
    return { from: formatYmd(addDays(currentWeekStart, -amount * 7)), to: formatYmd(addDays(currentWeekStart, -1)) }
  }

  const periodMonths = MONTHS_PER_UNIT[unit]
  const currentPeriodStartMonth = Math.floor(today.getMonth() / periodMonths) * periodMonths
  const currentPeriodStart = new Date(today.getFullYear(), currentPeriodStartMonth, 1)
  const start = new Date(today.getFullYear(), currentPeriodStartMonth - amount * periodMonths, 1)
  return { from: formatYmd(start), to: formatYmd(addDays(currentPeriodStart, -1)) }
}

/**
 * Resolves a relative window to inclusive from/to dates based on its qualifier: the current
 * period to date (this), the last N whole completed periods (last), or a rolling window of the
 * last N periods ending today (past)
 */
export function getRelativeRangeInputDates(
  amount: number,
  unit: SavedInsightsRangeUnit,
  qualifier: SavedInsightsRangeQualifier = 'past',
): InsightsRangeInputDates {
  const today = new Date()
  if (qualifier === 'this') {
    return getTrailingRangeInputDates(1, unit, today)
  }
  if (qualifier === 'last') {
    return getCompleteRangeInputDates(amount, unit, today)
  }
  return getTrailingRangeInputDates(amount, unit, today)
}

/**
 * Builds the human label for a relative window, for example "This quarter", "Last quarter", or
 * "Past 6 months"
 */
export function getRelativeRangeLabel(
  amount: number,
  unit: SavedInsightsRangeUnit,
  qualifier: SavedInsightsRangeQualifier = 'past',
) {
  if (qualifier === 'this') {
    return `This ${unit}`
  }
  if (qualifier === 'last' && amount === 1) {
    return `Last ${unit}`
  }
  const unitLabel = amount === 1 ? unit : `${unit}s`
  const verb = qualifier === 'last' ? 'Last' : 'Past'
  return `${verb} ${amount} ${unitLabel}`
}

/**
 * Formats a resolved from/to range for display, for example "Jan 1 – Jun 19", adding the year on
 * each end only when the range spans more than one calendar year
 */
export function formatResolvedRangeLabel(from: string, to: string) {
  const fromDate = parseYmd(from)
  const toDate = parseYmd(to)
  if (!fromDate || !toDate) return ''

  if (fromDate.getFullYear() === toDate.getFullYear()) {
    return `${getShortDateLabel(fromDate)} – ${getShortDateLabel(toDate)}`
  }
  return `${getShortDateLabel(fromDate)}, ${fromDate.getFullYear()} – ${getShortDateLabel(toDate)}, ${toDate.getFullYear()}`
}

/**
 * Maps a fixed range preset to the comparison period used to compute its previous-period deltas
 */
export function getRangeComparisonPeriod(preset: InsightsRangePreset): InsightsComparisonPeriod {
  switch (preset) {
    case 'THIS_MONTH':
    case 'LAST_MONTH':
      return 'previous_month'
    case 'THIS_YEAR':
      return 'previous_year'
    default:
      return 'same_length'
  }
}
