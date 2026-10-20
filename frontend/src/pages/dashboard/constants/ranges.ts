import type { SpendingRange } from '@/api/dashboard'

export const DASHBOARD_RANGE_OPTIONS: SpendingRange[] = ['WTD', 'MTD', 'QTD', 'YTD']

export const DASHBOARD_RANGE_SELECT_OPTIONS: Array<{ value: SpendingRange; label: SpendingRange; description: string }> = [
  { value: 'WTD', label: 'WTD', description: 'Week to date' },
  { value: 'MTD', label: 'MTD', description: 'Month to date' },
  { value: 'QTD', label: 'QTD', description: 'Quarter to date' },
  { value: 'YTD', label: 'YTD', description: 'Year to date' },
]

export const PREVIOUS_LABEL_BY_RANGE: Record<SpendingRange, string> = {
  WTD: 'Last week',
  MTD: 'Last month',
  QTD: 'Last quarter',
  YTD: 'Last year',
}

export const PREVIOUS_PERIOD_LABEL_BY_RANGE: Record<SpendingRange, string> = {
  WTD: 'week',
  MTD: 'month',
  QTD: 'quarter',
  YTD: 'year',
}

export const CURRENT_LABEL_BY_RANGE: Record<SpendingRange, string> = {
  WTD: 'This week',
  MTD: 'This month',
  QTD: 'This quarter',
  YTD: 'This year',
}
