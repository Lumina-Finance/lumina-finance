import type { SavingsRateSeriesPoint } from '@/components/charts/types'

export type SavingsRateHistoryPoint = SavingsRateSeriesPoint & {
  monthKey: string
  tickLabel: string
}
