import type { SavingsRateSeriesPoint } from '@/pages/dashboard/types/dashboard'

export type SavingsRateHistoryPoint = SavingsRateSeriesPoint & {
  monthKey: string
  tickLabel: string
}
