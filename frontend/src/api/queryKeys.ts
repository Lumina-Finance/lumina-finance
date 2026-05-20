import type { QueryKey } from '@tanstack/react-query';

interface SnapshotKeyParams {
  fromDate?: string;
  toDate?: string;
  granularity?: string;
  includeAnchor?: boolean;
}

export const accountKeys = {
  all: ['accounts'] as const,
  list: () => ['accounts'] as const,
  detail: (accountId: string | undefined) => ['accounts', accountId] as const,
  accountScope: (accountId: string) => ['accounts', accountId] as const,
  snapshots: (accountId: string | undefined, params: SnapshotKeyParams) => [
    'accounts',
    accountId,
    'snapshots',
    params.fromDate ?? null,
    params.toDate ?? null,
    params.granularity ?? 'day',
    params.includeAnchor ?? false,
  ] as const,
  spendingBreakdown: (accountId: string | undefined, range: string) => [
    'accounts',
    accountId,
    'spending-breakdown',
    range,
  ] as const,
  cashFlow: (accountId: string | undefined, months: number) => [
    'accounts',
    accountId,
    'cash-flow',
    months,
  ] as const,
};

export const transactionKeys = {
  all: ['transactions'] as const,
  detail: (transactionId: string | undefined) => ['transactions', transactionId] as const,
  list: (filters: Record<string, unknown>) => ['transactions', 'list', filters] as const,
  infinite: (filters: Record<string, unknown>, pageSize: number) => [
    'transactions',
    'infinite',
    filters,
    pageSize,
  ] as const,
};

export const transactionOverviewKeys = {
  all: ['transactions-overview'] as const,
  detail: (filters: Record<string, unknown>) => ['transactions-overview', filters] as const,
};

export const taxAdvantagedPlanKeys = {
  all: ['tax-advantaged-plans'] as const,
  list: () => ['tax-advantaged-plans'] as const,
  detail: (planId: string | null | undefined) => ['tax-advantaged-plans', planId] as const,
  limits: (planId: string | undefined) => ['tax-advantaged-plans', planId, 'limits'] as const,
};

export const dashboardKeys = {
  credit: () => ['dashboard-credit'] as const,
  netWorth: (windowDays: number) => ['dashboard-net-worth', windowDays] as const,
  netWorthAll: ['dashboard-net-worth'] as const,
  savingsRate: () => ['dashboard-savings-rate'] as const,
  savingsRateAll: ['dashboard-savings-rate'] as const,
  recentActivity: (windowDays: number) => ['dashboard-recent-activity', windowDays] as const,
  recentActivityAll: ['dashboard-recent-activity'] as const,
  spendingComparison: (range: string) => ['spending-comparison', range] as const,
  spendingComparisonAll: ['spending-comparison'] as const,
  spendingBreakdown: (range: string) => ['spending-breakdown', range] as const,
  spendingBreakdownAll: ['spending-breakdown'] as const,
};

export const insightsKeys = {
  periodGlance: (fromDate: string, toDate: string) => ['insights-period-glance', fromDate, toDate] as const,
  incomeExpenseFlow: (fromDate: string, toDate: string) => ['insights-income-expense-flow', fromDate, toDate] as const,
  incomeExpenseBreakdown: (fromDate: string, toDate: string) => ['insights-income-expense-breakdown', fromDate, toDate] as const,
  netWorth: (fromDate: string, toDate: string) => ['insights-net-worth', 'groups-v1', fromDate, toDate] as const,
  savingsRateTrend: () => ['insights-savings-rate-trend'] as const,
  merchantDistribution: (fromDate: string, toDate: string) => ['insights-merchant-distribution', fromDate, toDate] as const,
  merchantRanking: (fromDate: string, toDate: string) => ['insights-merchant-ranking', fromDate, toDate] as const,
};

export const budgetKeys = {
  all: ['budgets'] as const,
  baseBudgets: () => ['budgets', 'base-budgets'] as const,
  periods: () => ['budgets', 'periods'] as const,
  latestUtilizations: () => ['budgets', 'latest-utilizations'] as const,
  utilization: (budgetId: string) => ['budgets', 'periods', budgetId, 'utilization'] as const,
};

export const userKeys = {
  runwayAccounts: () => ['me', 'runway-accounts'] as const,
  runway: () => ['me', 'runway'] as const,
};

export const categoryKeys = {
  list: () => ['categories'] as const,
};

export const merchantKeys = {
  all: ['merchants'] as const,
  detail: (merchantId: string | null | undefined) => ['merchants', merchantId] as const,
  infinite: (filters: Record<string, unknown>, pageSize: number) => [
    'merchants',
    'infinite',
    filters,
    pageSize,
  ] as const,
};

export const tagKeys = {
  all: ['tags'] as const,
  detail: (tagId: string | null | undefined) => ['tags', tagId] as const,
  infinite: (filters: Record<string, unknown>, pageSize: number) => [
    'tags',
    'infinite',
    filters,
    pageSize,
  ] as const,
};

export const institutionKeys = {
  list: () => ['institutions'] as const,
};

export const currencyKeys = {
  list: () => ['currencies'] as const,
};

export type FocusRefetchTarget = QueryKey | { queryKey: QueryKey; exact?: boolean };
