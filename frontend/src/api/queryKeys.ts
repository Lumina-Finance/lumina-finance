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
  all: ['dashboard'] as const,
  summary: (windowDays: number) => ['dashboard', windowDays] as const,
  spendingComparison: (range: string) => ['spending-comparison', range] as const,
  spendingComparisonAll: ['spending-comparison'] as const,
  spendingBreakdown: (range: string) => ['spending-breakdown', range] as const,
  spendingBreakdownAll: ['spending-breakdown'] as const,
};

export const userKeys = {
  runwayAccounts: () => ['me', 'runway-accounts'] as const,
  runway: () => ['me', 'runway'] as const,
};

export type FocusRefetchTarget = QueryKey | { queryKey: QueryKey; exact?: boolean };
