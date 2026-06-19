export type InsightsRangePreset = 'THIS_MONTH' | 'LAST_MONTH' | 'LAST_30_DAYS' | 'LAST_90_DAYS' | 'THIS_YEAR' | 'CUSTOM'

export type InsightsComparisonPeriod = 'same_length' | 'previous_month' | 'previous_year'

// Relative window units a saved range can step back by, mirrored from the backend schema
export type SavedInsightsRangeUnit = 'day' | 'week' | 'month' | 'quarter' | 'year'

// How a window is anchored, mirrored from the backend: the current period to date (this), the
// previous complete period(s) (last), or a rolling window of the last N periods ending today (past)
export type SavedInsightsRangeQualifier = 'this' | 'last' | 'past'

export type InsightsRangeInputDates = {
  from: string
  to: string
}
