import type { BalanceRange } from '@/pages/accounts/detail/constants/accountDetail'
import { formatCurrency } from '@/utils/formatCurrency'
import { calendarDateMs } from './calendarDate'
import { DATE_FORMATS, formatDate } from '@/utils/date'

const DAY_MS = 24 * 60 * 60 * 1000
const BALANCE_AXIS_TICK_COUNT_BY_RANGE: Record<BalanceRange, number> = {
  '7D': 7,
  '30D': 6,
  '90D': 6,
  '1Y': 6,
}

/**
 * Spreads the tick count chosen for the selected range evenly between the first and last day of
 * the balance chart, always landing exactly on both ends
 *
 * A range spanning fewer days than the tick count would otherwise repeat a day, so duplicates are
 * dropped and the axis simply carries fewer ticks
 */
export function getBalanceXAxisTicks(fromDate: Date, toDate: Date, range: BalanceRange): number[] {
  const startMs = calendarDateMs(fromDate)
  const endMs = calendarDateMs(toDate)
  const tickCount = BALANCE_AXIS_TICK_COUNT_BY_RANGE[range]
  if (tickCount <= 1 || startMs >= endMs) return [startMs]

  const totalDays = Math.round((endMs - startMs) / DAY_MS)
  return [...new Set(Array.from({ length: tickCount }, (_, index) => {
    if (index === 0) return startMs
    if (index === tickCount - 1) return endMs
    const dayOffset = Math.round((totalDays * index) / (tickCount - 1))
    return startMs + dayOffset * DAY_MS
  }))]
}

/**
 * Labels a balance chart tick with its short month and day, read in UTC to match the way the tick
 * timestamps were built
 */
export function formatUtcAxisDate(value: number): string {
  return formatDate(new Date(value), DATE_FORMATS.monthDay, 'UTC')
}

/**
 * Formats a change in balance with an explicit plus or minus in front of it, leaving an unchanged
 * balance with no sign at all
 */
export function formatSignedBalanceCurrency(amount: number, currency: string): string {
  if (amount === 0) return formatCurrency(amount, currency)
  return `${amount > 0 ? '+' : '−'}${formatCurrency(Math.abs(amount), currency)}`
}
