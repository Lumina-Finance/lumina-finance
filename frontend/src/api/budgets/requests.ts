import { authenticatedFetch } from '@/api/client';
import type {
  BaseBudget,
  Budget,
  BudgetUtilization,
  CreateBaseBudgetPayload,
  CreateBudgetPayload,
  LatestBudgetUtilization,
  UpdateBaseBudgetPayload,
  UpdateBudgetPayload,
} from '@/api/budgets/types';

/**
 * Fetches base budget definitions
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchBaseBudgets(signal?: AbortSignal) {
  return authenticatedFetch<BaseBudget[]>('/base-budgets', { signal });
}

/**
 * Fetches budget periods
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchBudgets(signal?: AbortSignal) {
  return authenticatedFetch<Budget[]>('/budgets', { signal });
}

/**
 * Fetches latest utilization for each active base budget
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchLatestBudgetUtilizations(signal?: AbortSignal) {
  return authenticatedFetch<LatestBudgetUtilization[]>('/budgets/latest-utilizations', { signal });
}

/**
 * Fetches utilization for every stored period under a base budget in one batched request
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchBaseBudgetUtilizations(baseBudgetId: string, signal?: AbortSignal) {
  return authenticatedFetch<BudgetUtilization[]>(`/base-budgets/${baseBudgetId}/utilizations`, { signal });
}

/**
 * Creates a base budget and optional first budget period
 */
export function createBaseBudget(payload: CreateBaseBudgetPayload) {
  return authenticatedFetch<BaseBudget>('/base-budgets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Creates a budget period under a base budget
 */
export function createBudgetInstance({ baseBudgetId, ...payload }: CreateBudgetPayload) {
  return authenticatedFetch<Budget>(`/base-budgets/${baseBudgetId}/budgets`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Deletes a base budget and its periods
 */
export function deleteBaseBudget(baseBudgetId: string) {
  return authenticatedFetch<void>(`/base-budgets/${baseBudgetId}`, {
    method: 'DELETE',
  });
}

/**
 * Updates mutable base budget fields
 */
export function updateBaseBudget({ id, patch }: UpdateBaseBudgetPayload) {
  return authenticatedFetch<BaseBudget>(`/base-budgets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/**
 * Updates mutable budget period fields
 */
export function updateBudget({ id, patch }: UpdateBudgetPayload) {
  return authenticatedFetch<Budget>(`/budgets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}
