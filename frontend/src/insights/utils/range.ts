import type { InsightsRangeInputDates, InsightsRangePreset } from '../types/range'
import {
  addDays,
  formatYmd,
  parseYmd,
} from './date'

function getRangeDates(preset: InsightsRangePreset, customFrom: string, customTo: string) {
  if (preset === 'CUSTOM') {
    const fromDate = parseYmd(customFrom)
    const toDate = parseYmd(customTo)
    if (fromDate && toDate && fromDate <= toDate) {
      const dates: Date[] = []
      let cursor = fromDate
      while (cursor <= toDate) {
        dates.push(cursor)
        cursor = addDays(cursor, 1)
      }
      return dates
    }
  }

  const today = new Date()
  const rangeBoundary = (() => {
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
      case 'CUSTOM':
        return { start: addDays(today, -29), end: today }
      default:
        return { start: addDays(today, -29), end: today }
    }
  })()

  const dates: Date[] = []
  let cursor = rangeBoundary.start
  while (cursor <= rangeBoundary.end) {
    dates.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return dates
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
  if (preset === 'CUSTOM') {
    return { from: customFrom, to: customTo }
  }

  const dates = getRangeDates(preset, customFrom, customTo)
  const firstDate = dates[0]
  const lastDate = dates.at(-1)
  return {
    from: firstDate ? formatYmd(firstDate) : customFrom,
    to: lastDate ? formatYmd(lastDate) : customTo,
  }
}
