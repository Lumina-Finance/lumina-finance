import type { BalanceRange } from '@/accounts/detail/constants/accountDetail'
import { formatCurrency } from '@/utils/formatCurrency'

const DAY_MS = 24 * 60 * 60 * 1000
const BALANCE_AXIS_TICK_COUNT_BY_RANGE: Record<BalanceRange, number> = {
  '7D': 7,
  '30D': 6,
  '90D': 6,
  '1Y': 6,
}

export function calendarDateMs(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
}

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

export function formatUtcAxisDate(value: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value))
}

export function formatSignedBalanceCurrency(amount: number, currency: string): string {
  if (amount === 0) return formatCurrency(amount, currency)
  return `${amount > 0 ? '+' : '−'}${formatCurrency(Math.abs(amount), currency)}`
}
