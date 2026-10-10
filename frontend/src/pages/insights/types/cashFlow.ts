export type { ChartGranularity as CashFlowGranularity } from '@/utils/chartGranularity'

export type CashFlowBarBucket = {
  label: string
  rangeLabel: string
  inflow: number
  outflow: number
  net: number
}
