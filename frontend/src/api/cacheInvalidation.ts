import type { QueryClient, QueryKey } from '@tanstack/react-query'
import {
  accountKeys,
  budgetKeys,
  categoryKeys,
  dashboardKeys,
  insightsKeys,
  institutionKeys,
  merchantKeys,
  tagKeys,
  taxAdvantagedPlanKeys,
  transactionKeys,
  transactionOverviewKeys,
  userKeys,
} from '@/api/queryKeys'

interface InvalidationTarget {
  queryKey: QueryKey
  exact?: boolean
}

const dashboardTargets: InvalidationTarget[] = [
  { queryKey: dashboardKeys.credit(), exact: true },
  { queryKey: dashboardKeys.netWorthAll },
  { queryKey: dashboardKeys.savingsRateAll },
  { queryKey: dashboardKeys.recentActivityAll },
  { queryKey: dashboardKeys.spendingComparisonAll },
  { queryKey: dashboardKeys.spendingBreakdownAll },
]

const insightsTargets: InvalidationTarget[] = [
  { queryKey: insightsKeys.periodGlanceAll },
  { queryKey: insightsKeys.fundFlowAll },
  { queryKey: insightsKeys.incomeExpenseBreakdownAll },
  { queryKey: insightsKeys.cashFlowAll },
  { queryKey: insightsKeys.netWorthAll },
  { queryKey: insightsKeys.savingsRateTrendAll },
  { queryKey: insightsKeys.merchantsAll },
]

const runwayTargets: InvalidationTarget[] = [
  { queryKey: userKeys.runwayAccounts(), exact: true },
  { queryKey: userKeys.runwaySettings(), exact: true },
  { queryKey: userKeys.runway(), exact: true },
]

const aggregateTargets: InvalidationTarget[] = [
  { queryKey: accountKeys.all },
  { queryKey: transactionKeys.all },
  { queryKey: transactionOverviewKeys.all },
  { queryKey: taxAdvantagedPlanKeys.all },
  { queryKey: budgetKeys.all },
  ...dashboardTargets,
  ...insightsTargets,
  ...runwayTargets,
]

const appDataTargets: InvalidationTarget[] = [
  ...aggregateTargets,
  { queryKey: categoryKeys.list(), exact: true },
  { queryKey: merchantKeys.all },
  { queryKey: tagKeys.all },
  { queryKey: institutionKeys.list(), exact: true },
]

export function invalidateDashboardData(queryClient: QueryClient) {
  invalidateTargets(queryClient, dashboardTargets)
}

export function invalidateInsightsData(queryClient: QueryClient) {
  invalidateTargets(queryClient, insightsTargets)
}

export function invalidateAggregateData(queryClient: QueryClient) {
  invalidateTargets(queryClient, aggregateTargets)
}

export function invalidateAppData(queryClient: QueryClient) {
  invalidateTargets(queryClient, appDataTargets)
}

export function invalidateFxData(queryClient: QueryClient) {
  invalidateTargets(queryClient, aggregateTargets)
}

function invalidateTargets(queryClient: QueryClient, targets: InvalidationTarget[]) {
  for (const target of targets) {
    queryClient.invalidateQueries({
      queryKey: target.queryKey,
      exact: target.exact ?? false,
      refetchType: 'active',
    })
  }
}
