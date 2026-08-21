import type { AccountSpendingBreakdown, SpendingRange } from '@/api/accounts'
import type { TimeRangeSelectorOption } from '@/components/time-range/Selector'

export const SPENDING_RANGE_OPTIONS: TimeRangeSelectorOption<SpendingRange>[] = [
  { value: 'WTD', label: 'WTD', description: 'Week to date' },
  { value: 'MTD', label: 'MTD', description: 'Month to date' },
  { value: 'QTD', label: 'QTD', description: 'Quarter to date' },
  { value: 'YTD', label: 'YTD', description: 'Year to date' },
]

export const BREAKDOWN_CARD_LIST_MIN_HEIGHT = 270
export const BREAKDOWN_OTHER_COLOR = '#8C8074'

export type BreakdownRow = {
  key: string
  name: string
  total: number
  isOther: boolean
  color?: string
}

export type BreakdownSnapshot = {
  rows: BreakdownRow[]
  grandTotal: number
  currency: string
  emptyLabel: string
}

/**
 * Adds an Other row when the backend reports hidden entries beyond the visible top rows
 */
export function appendOtherBreakdownRow(
  rows: BreakdownRow[],
  otherCount: number,
  grandTotal: number,
): BreakdownRow[] {
  if (otherCount <= 0) return rows
  const topSum = rows.reduce((sum, row) => sum + row.total, 0)
  const otherTotal = Math.max(grandTotal - topSum, 0)
  return [...rows, { key: 'other', name: `Other (${otherCount})`, total: otherTotal, isOther: true }]
}

/**
 * Converts a row total into the proportional fill width shown behind the breakdown row
 */
export function getBreakdownRowFillPercent(rowTotal: number, grandTotal: number): number {
  const totalAbs = Math.abs(grandTotal)
  return totalAbs > 0 ? Math.max((Math.abs(rowTotal) / totalAbs) * 100, 4) : 0
}

/**
 * Projects a backend breakdown payload into rows and optional Other row
 *
 * Each card carries its own total, so the caller says which one its rows belong to. Handing the
 * other card's total here would size the Other row against spending these rows never held
 */
export function getBreakdownRows(
  data: AccountSpendingBreakdown | undefined,
  toRows: (breakdown: AccountSpendingBreakdown) => BreakdownRow[],
  otherCount: (breakdown: AccountSpendingBreakdown) => number,
  cardTotal: (breakdown: AccountSpendingBreakdown) => number,
): BreakdownRow[] {
  if (!data) return []
  return appendOtherBreakdownRow(toRows(data), otherCount(data), cardTotal(data))
}
