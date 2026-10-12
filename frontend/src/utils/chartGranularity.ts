export type ChartGranularity = 'day' | 'week' | 'month'

// The backend's cut-offs for grouping a chart's range into buckets, in
// backend/app/utils/cash_flow_bucket_helpers.py and services/insights/net_worth/bucket_helpers.py.
// The charts caption and label their buckets from these, so a different value here describes a
// weekly bucket as a monthly one
const DAILY_RANGE_MAX_DAYS = 31
const WEEKLY_RANGE_MAX_DAYS = 183

/**
 * Returns the bucket size the backend groups an inclusive range of this many days into
 */
export function getChartGranularity(dayCount: number): ChartGranularity {
  if (dayCount <= DAILY_RANGE_MAX_DAYS) return 'day'
  if (dayCount <= WEEKLY_RANGE_MAX_DAYS) return 'week'
  return 'month'
}
