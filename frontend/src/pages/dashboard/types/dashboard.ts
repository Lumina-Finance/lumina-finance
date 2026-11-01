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

export type SpendingComparisonSeriesPoint = {
  label: string
  current: number | null
  previous: number | null
  average: number | null
}

/** Which earlier readings the second line of the spending comparison draws */
export type SpendingComparisonBasis = 'previous' | 'average'

export type RunwaySegment = {
  id: string
  name: string
  amount: number
  pct: number
  centerPct: number
  color: string
}
