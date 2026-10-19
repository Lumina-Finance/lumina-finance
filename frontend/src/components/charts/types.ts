export type SavingsRateSeriesPoint = {
  monthLabel: string
  fullLabel: string
  rate: number | null
  income: number
  expenses: number
  isCurrent: boolean
}
