import type { QueryClient } from '@tanstack/react-query';
import {
  accountKeys,
  budgetKeys,
  taxAdvantagedCategoryKeys,
  transactionKeys,
  transactionOverviewKeys,
  userKeys,
} from '@/api/cache/queryKeys';
import { dashboardTargets } from '@/api/cache/invalidation/dashboard';
import { insightsTargets } from '@/api/cache/invalidation/insights';
import { referenceDataTargets } from '@/api/cache/invalidation/referenceData';
import { runwayTargets } from '@/api/cache/invalidation/runway';
import { invalidateTargets, type InvalidationTarget } from '@/api/cache/invalidation/types';

const aggregateTargets: InvalidationTarget[] = [
  { queryKey: accountKeys.all },
  { queryKey: transactionKeys.all },
  { queryKey: transactionOverviewKeys.all },
  { queryKey: taxAdvantagedCategoryKeys.all },
  { queryKey: budgetKeys.all },
  ...dashboardTargets,
  ...insightsTargets,
  ...runwayTargets,
];

const appDataTargets: InvalidationTarget[] = [
  ...aggregateTargets,
  ...referenceDataTargets,
];

const fxTargets: InvalidationTarget[] = [
  { queryKey: accountKeys.all },
  { queryKey: transactionKeys.all },
  { queryKey: transactionOverviewKeys.all },
  { queryKey: taxAdvantagedCategoryKeys.all },
  { queryKey: budgetKeys.all },
  ...dashboardTargets,
  ...insightsTargets,
  { queryKey: userKeys.runway(), exact: true },
];

/**
 * Invalidates account, transaction, budget, dashboard, insights, and runway data
 */
export function invalidateAggregateData(queryClient: QueryClient) {
  invalidateTargets(queryClient, aggregateTargets);
}

/**
 * Invalidates all app data after imports or broad session data changes
 */
export function invalidateAppData(queryClient: QueryClient) {
  invalidateTargets(queryClient, appDataTargets);
}

/**
 * Invalidates data whose displayed values depend on exchange rates
 */
export function invalidateFxData(queryClient: QueryClient) {
  invalidateTargets(queryClient, fxTargets);
}
