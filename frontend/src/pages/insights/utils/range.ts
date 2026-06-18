import type {
  InsightsComparisonPeriod,
  InsightsRangeInputDates,
  InsightsRangePreset,
  SavedInsightsRangeUnit,
} from '../types/range'
import { addDays, formatYmd, getStartOfWeek, parseYmd } from './date'

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
 * Resolves a relative "last N units" window to inclusive from/to dates ending today
 *
 * Day windows count the exact number of trailing days ending today. Week, month, quarter, and
 * year windows align the start to the beginning of the earliest whole period they cover, so the
 * window always reaches back to a week, month, quarter, or year boundary
 */
export function getRelativeRangeInputDates(
  amount: number,
  unit: SavedInsightsRangeUnit,
): InsightsRangeInputDates {
  const today = new Date()

  if (unit === 'day') {
    return { from: formatYmd(addDays(today, -(amount - 1))), to: formatYmd(today) }
  }
  if (unit === 'week') {
    const start = addDays(getStartOfWeek(today), -(amount - 1) * 7)
    return { from: formatYmd(start), to: formatYmd(today) }
  }

  // Roll back to the first day of the month, quarter, or year that opens the window so the span
  // covers whole calendar periods up to today regardless of which day of the period it is
  const periodMonths = MONTHS_PER_UNIT[unit]
  const alignedStartMonth = Math.floor(today.getMonth() / periodMonths) * periodMonths - (amount - 1) * periodMonths
  const start = new Date(today.getFullYear(), alignedStartMonth, 1)
  return { from: formatYmd(start), to: formatYmd(today) }
}

/**
 * Builds the human label for a relative window, for example "Last 6 months"
 */
export function getRelativeRangeLabel(amount: number, unit: SavedInsightsRangeUnit) {
  const unitLabel = amount === 1 ? unit : `${unit}s`
  return `Last ${amount} ${unitLabel}`
}

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
