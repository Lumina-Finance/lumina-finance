export type InsightsRangePreset = 'THIS_MONTH' | 'LAST_MONTH' | 'LAST_30_DAYS' | 'LAST_90_DAYS' | 'THIS_YEAR' | 'CUSTOM'

export type InsightsComparisonPeriod = 'same_length' | 'previous_month' | 'previous_year'

// Relative window units a saved range can step back by, mirrored from the backend schema
export type SavedInsightsRangeUnit = 'day' | 'week' | 'month' | 'quarter' | 'year'

export type InsightsRangeInputDates = {
  from: string
  to: string
}
