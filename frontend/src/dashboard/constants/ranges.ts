import type { SpendingRange } from '@/api/dashboard'

export const DASHBOARD_RANGE_OPTIONS: SpendingRange[] = ['WTD', 'MTD', 'QTD', 'YTD']

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
