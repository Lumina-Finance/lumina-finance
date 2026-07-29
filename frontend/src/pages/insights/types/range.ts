export type InsightsRangePreset = 'THIS_MONTH' | 'LAST_MONTH' | 'LAST_30_DAYS' | 'LAST_90_DAYS' | 'THIS_YEAR' | 'CUSTOM'

// A custom range is built from an amount, a unit and a qualifier, so its dates cannot be worked
// out from the preset name alone the way every other preset's can
export type InsightsFixedRangePreset = Exclude<InsightsRangePreset, 'CUSTOM'>

export type InsightsRangeInputDates = {
  from: string
  to: string
}
