import type { FxStatus } from '@/api/dashboard'

export type CreditTier = 'positive' | 'accent' | 'negative'

export type SavingsTier = 'positive' | 'accent' | 'negative'

export type DashboardMoneyFormat = 'raw' | 'netWorth' | 'credit' | 'breakdown'

export type TopBudget = {
  budget_id: string
  base_budget_id: string
  name: string
  currency: string
  period_end: string
  overall_limit: number
  total_spent: number
  fx_status: FxStatus
  usageRatio: number
  usagePct: number
}

export type BudgetAttentionState = {
  label: 'On track' | 'Watch' | 'Needs attention'
  background: string
  textColor: string
  indicatorColor: string
}

export type CategoryMapEntry = {
  name: string
  kind: 'expense' | 'income' | 'transfer'
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
