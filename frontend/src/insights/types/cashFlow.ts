export type CashFlowGranularity = 'day' | 'week' | 'month'

export type CashFlowBarBucket = {
  label: string
  rangeLabel: string
  inflow: number
  outflow: number
  net: number
}
