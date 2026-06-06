export type InsightsRangePreset = 'THIS_MONTH' | 'LAST_MONTH' | 'LAST_30_DAYS' | 'LAST_90_DAYS' | 'THIS_YEAR' | 'CUSTOM'

export type InsightsComparisonPeriod = 'same_length' | 'previous_month' | 'previous_year'

export type InsightsRangeInputDates = {
  from: string
  to: string
}
