import type { SpendingRange } from '@/api/dashboard'

export const DASHBOARD_RANGE_OPTIONS: SpendingRange[] = ['WTD', 'MTD', 'QTD', 'YTD']

export const DASHBOARD_RANGE_SELECT_OPTIONS: Array<{ value: SpendingRange; label: SpendingRange; description: string }> = [
  { value: 'WTD', label: 'WTD', description: 'Week to date' },
  { value: 'MTD', label: 'MTD', description: 'Month to date' },
  { value: 'QTD', label: 'QTD', description: 'Quarter to date' },
  { value: 'YTD', label: 'YTD', description: 'Year to date' },
]

export const PREVIOUS_LABEL_BY_RANGE: Record<SpendingRange, string> = {
  WTD: 'Last Week',
  MTD: 'Last Month',
  QTD: 'Last Quarter',
  YTD: 'Last Year',
}

export const PREVIOUS_PERIOD_LABEL_BY_RANGE: Record<SpendingRange, string> = {
  WTD: 'Week',
  MTD: 'Month',
  QTD: 'Quarter',
  YTD: 'Year',
}

export const CURRENT_LABEL_BY_RANGE: Record<SpendingRange, string> = {
  WTD: 'This Week',
  MTD: 'This Month',
  QTD: 'This Quarter',
  YTD: 'This Year',
}
