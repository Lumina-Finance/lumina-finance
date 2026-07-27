import type { LatestBudgetUtilization } from '@/api/budgets'

export type CreditTier = 'positive' | 'accent' | 'negative'

export type SavingsTier = 'positive' | 'accent' | 'negative'

export type DashboardMoneyFormat = 'raw' | 'netWorth' | 'credit' | 'breakdown'

export type TopBudget = Omit<LatestBudgetUtilization, 'period_start' | 'categories'> & {
  usageRatio: number
  usagePct: number
}

export type NetWorthSeriesPoint = {
  date: string
  value: number
}

export type SavingsRateSeriesPoint = {
  monthLabel: string
  fullLabel: string
  rate: number | null
  income: number
  expenses: number
  isCurrent: boolean
}

export type SpendingComparisonSeriesPoint = {
  label: string
  current: number | null
  previous: number | null
}

export type RunwaySegment = {
  id: string
  name: string
  amount: number
  pct: number
  centerPct: number
  color: string
}
