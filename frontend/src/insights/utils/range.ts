import type { InsightsComparisonPeriod, InsightsRangeInputDates, InsightsRangePreset } from '../types/range'
import {
  addDays,
  formatYmd,
  parseYmd,
} from './date'

function getEffectiveRangeBounds(
  preset: InsightsRangePreset,
  customFrom: string,
  customTo: string,
): { start: Date; end: Date } {
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
    case 'LAST_30_DAYS':
      return { start: addDays(today, -29), end: today }
    case 'LAST_90_DAYS':
      return { start: addDays(today, -89), end: today }
    case 'CUSTOM': {
      const fromDate = parseYmd(customFrom)
      const toDate = parseYmd(customTo)
      if (fromDate && toDate && fromDate <= toDate) {
        return { start: fromDate, end: toDate }
      }
      return { start: addDays(today, -29), end: today }
    }
    default:
      return { start: addDays(today, -29), end: today }
  }
}

function getDisplayRangeBounds(
  preset: InsightsRangePreset,
  customFrom: string,
  customTo: string,
): { start: Date; end: Date } {
  const today = new Date()

  switch (preset) {
    case 'THIS_MONTH':
      return {
        start: new Date(today.getFullYear(), today.getMonth(), 1),
        end: new Date(today.getFullYear(), today.getMonth() + 1, 0),
      }
    case 'THIS_YEAR':
      return {
        start: new Date(today.getFullYear(), 0, 1),
        end: new Date(today.getFullYear(), 11, 31),
      }
    default:
      return getEffectiveRangeBounds(preset, customFrom, customTo)
  }
}

function formatRangeBounds({ start, end }: { start: Date; end: Date }): InsightsRangeInputDates {
  return { from: formatYmd(start), to: formatYmd(end) }
}

export function getDefaultCustomRange(): InsightsRangeInputDates {
  const today = new Date()
  return {
    from: formatYmd(addDays(today, -29)),
    to: formatYmd(today),
  }
}

export function getCustomRangeDays(from: string, to: string) {
  const fromDate = parseYmd(from)
  const toDate = parseYmd(to)
  if (!fromDate || !toDate || fromDate > toDate) return null
  return Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1)
}

export function getRangeInputDates(
  preset: InsightsRangePreset,
  customFrom: string,
  customTo: string,
): InsightsRangeInputDates {
  return formatRangeBounds(getEffectiveRangeBounds(preset, customFrom, customTo))
}

export function getRangeDisplayDates(
  preset: InsightsRangePreset,
  customFrom: string,
  customTo: string,
): InsightsRangeInputDates {
  return formatRangeBounds(getDisplayRangeBounds(preset, customFrom, customTo))
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
