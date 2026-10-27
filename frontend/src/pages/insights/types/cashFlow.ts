export type { ChartGranularity as CashFlowGranularity } from '@/utils/chartGranularity'

export type CashFlowBarBucket = {
  // What the axis writes under the bar, which repeats across years, so the tooltip lookup uses rangeLabel
  label: string
  rangeLabel: string
  // Whether the label carries the year, which marks where the year turns on a range over two calendar years
  marksYear: boolean
  inflow: number
  outflow: number
  net: number
}
