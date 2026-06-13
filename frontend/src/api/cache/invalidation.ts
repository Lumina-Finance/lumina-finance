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
  taxAdvantagedCategoryKeys,
  transactionKeys,
  transactionOverviewKeys,
  userKeys,
} from '@/api/cache/queryKeys'

interface InvalidationTarget {
  queryKey: QueryKey
  exact?: boolean
}

const dashboardBalanceTargets: InvalidationTarget[] = [
  { queryKey: dashboardKeys.netWorthAll },
]

const dashboardCreditTargets: InvalidationTarget[] = [
  { queryKey: dashboardKeys.credit(), exact: true },
]

const dashboardRecentTargets: InvalidationTarget[] = [
  { queryKey: dashboardKeys.recentActivityAll },
]

const dashboardIncomeExpenseTargets: InvalidationTarget[] = [
  { queryKey: dashboardKeys.savingsRateAll },
  { queryKey: dashboardKeys.spendingComparisonAll },
  { queryKey: dashboardKeys.spendingBreakdownAll },
]

const dashboardBudgetTargets: InvalidationTarget[] = [
  { queryKey: budgetKeys.latestUtilizations(), exact: true },
]

const dashboardTargets: InvalidationTarget[] = [
  ...dashboardBalanceTargets,
  ...dashboardCreditTargets,
  ...dashboardRecentTargets,
  ...dashboardIncomeExpenseTargets,
  ...dashboardBudgetTargets,
]

const insightsBalanceTargets: InvalidationTarget[] = [
  { queryKey: insightsKeys.periodGlanceAll },
  { queryKey: insightsKeys.netWorthAll },
]

const insightsIncomeExpenseTargets: InvalidationTarget[] = [
  { queryKey: insightsKeys.periodGlanceAll },
  { queryKey: insightsKeys.fundFlowAll },
  { queryKey: insightsKeys.incomeExpenseBreakdownAll },
  { queryKey: insightsKeys.cashFlowAll },
  { queryKey: insightsKeys.savingsRateTrendAll },
]

const insightsMerchantTargets: InvalidationTarget[] = [
  { queryKey: insightsKeys.merchantsAll },
]

const insightsTargets: InvalidationTarget[] = [
  ...insightsBalanceTargets,
  ...insightsIncomeExpenseTargets,
  ...insightsMerchantTargets,
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
  { queryKey: taxAdvantagedCategoryKeys.all },
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

const fxTargets: InvalidationTarget[] = [
  { queryKey: accountKeys.all },
  { queryKey: transactionKeys.all },
  { queryKey: transactionOverviewKeys.all },
  { queryKey: taxAdvantagedCategoryKeys.all },
  { queryKey: budgetKeys.all },
  ...dashboardTargets,
  ...insightsTargets,
  { queryKey: userKeys.runway(), exact: true },
]

export function invalidateTransactions(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: transactionKeys.all }])
}

export function invalidateTransactionOverview(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: transactionOverviewKeys.all }])
}

export function invalidateAccountSummaries(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: accountKeys.list(), exact: true }])
}

export function invalidateAccounts(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: accountKeys.all }])
}

export function invalidateAccountDetails(queryClient: QueryClient, accountIds: string[]) {
  invalidateTargets(queryClient, accountIds.map((accountId) => ({
    queryKey: accountKeys.detail(accountId),
    exact: true,
  })))
}

export function invalidateAccountBalances(queryClient: QueryClient, accountIds: string[]) {
  invalidateAccountSummaries(queryClient)
  invalidateTargets(queryClient, accountIds.flatMap((accountId) => [
    { queryKey: accountKeys.detail(accountId), exact: true },
    { queryKey: accountKeys.snapshotsAll(accountId) },
  ]))
}

export function invalidateAccountActivity(queryClient: QueryClient, accountIds: string[]) {
  invalidateTargets(queryClient, accountIds.flatMap((accountId) => [
    { queryKey: accountKeys.spendingBreakdownAll(accountId) },
    { queryKey: accountKeys.cashFlowAll(accountId) },
  ]))
}

export function invalidateAccountData(queryClient: QueryClient, accountIds: string[]) {
  invalidateAccountSummaries(queryClient)
  invalidateTargets(queryClient, accountIds.map((accountId) => ({
    queryKey: accountKeys.accountScope(accountId),
  })))
}

export function invalidateDashboardBalance(queryClient: QueryClient) {
  invalidateTargets(queryClient, dashboardBalanceTargets)
}

export function invalidateDashboardCredit(queryClient: QueryClient) {
  invalidateTargets(queryClient, dashboardCreditTargets)
}

export function invalidateDashboardRecent(queryClient: QueryClient) {
  invalidateTargets(queryClient, dashboardRecentTargets)
}

export function invalidateDashboardIncomeExpense(queryClient: QueryClient) {
  invalidateTargets(queryClient, dashboardIncomeExpenseTargets)
}

export function invalidateDashboardBudgets(queryClient: QueryClient) {
  invalidateTargets(queryClient, dashboardBudgetTargets)
}

export function invalidateDashboardData(queryClient: QueryClient) {
  invalidateTargets(queryClient, dashboardTargets)
}

export function invalidateInsightsBalance(queryClient: QueryClient) {
  invalidateTargets(queryClient, insightsBalanceTargets)
}

export function invalidateInsightsIncomeExpense(queryClient: QueryClient) {
  invalidateTargets(queryClient, insightsIncomeExpenseTargets)
}

export function invalidateInsightsMerchants(queryClient: QueryClient) {
  invalidateTargets(queryClient, insightsMerchantTargets)
}

export function invalidateInsightsData(queryClient: QueryClient) {
  invalidateTargets(queryClient, insightsTargets)
}

export function invalidateBudgets(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: budgetKeys.all }])
}

export function invalidateRunway(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: userKeys.runway(), exact: true }])
}

export function invalidateRunwaySettings(queryClient: QueryClient) {
  invalidateTargets(queryClient, runwayTargets)
}

export function invalidateTaxAdvantagedCategories(
  queryClient: QueryClient,
  categoryIds: Array<string | null | undefined> = [],
) {
  const uniqueCategoryIds = uniqueIds(categoryIds)
  invalidateTargets(queryClient, [
    { queryKey: taxAdvantagedCategoryKeys.list(), exact: true },
    ...uniqueCategoryIds.map((categoryId) => ({
      queryKey: taxAdvantagedCategoryKeys.detail(categoryId),
      exact: true,
    })),
  ])
}

export function invalidateTaxAdvantagedCategoryOverview(queryClient: QueryClient) {
  invalidateTargets(queryClient, [
    { queryKey: taxAdvantagedCategoryKeys.list(), exact: true },
    { queryKey: accountKeys.list(), exact: true },
  ])
}

export function invalidateCategories(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: categoryKeys.list(), exact: true }])
}

export function invalidateMerchants(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: merchantKeys.all }])
}

export function invalidateTags(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: tagKeys.all }])
}

export function invalidateAggregateData(queryClient: QueryClient) {
  invalidateTargets(queryClient, aggregateTargets)
}

export function invalidateAppData(queryClient: QueryClient) {
  invalidateTargets(queryClient, appDataTargets)
}

export function invalidateFxData(queryClient: QueryClient) {
  invalidateTargets(queryClient, fxTargets)
}

function invalidateTargets(queryClient: QueryClient, targets: InvalidationTarget[]) {
  const seen = new Set<string>()
  for (const target of targets) {
    const cacheKey = JSON.stringify([target.queryKey, target.exact ?? false])
    if (seen.has(cacheKey)) continue
    seen.add(cacheKey)

    queryClient.invalidateQueries({
      queryKey: target.queryKey,
      exact: target.exact ?? false,
      refetchType: 'active',
    })
  }
}

function uniqueIds(ids: Array<string | null | undefined>) {
  return [...new Set(ids.filter((id): id is string => !!id))]
}
