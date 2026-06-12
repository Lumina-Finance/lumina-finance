import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { authenticatedFetch } from '@/api/client';
import {
  invalidateTaxPlanOverview,
  invalidateTaxPlans,
} from '@/api/cacheInvalidation';
import { accountKeys, taxAdvantagedPlanKeys } from '@/api/queryKeys';
import type { Account, AccountsOverview } from '@/api/accounts';
import { runWithMinimumPendingTime } from '@/api/mutationFeedback';

export type TaxTreatment = 'tax_free' | 'tax_deferred' | 'tax_assisted';

export interface TaxAdvantagedPlan {
  id: string;
  category_owner_user_id: string;
  group_id: string | null;
  name: string;
  tax_treatment: TaxTreatment;
  currency: string;
  lifetime_contribution_limit: number | null;
  accrued_contributions: number;
  accrued_lifetime_contribution_limit: number | null;
  current_year_contribution_limit: number | null;
  current_year_withdrawal_limit: number | null;
  ytd_contributions: number;
  ytd_withdrawals: number;
  lifetime_contributions: number;
  lifetime_withdrawals: number;
  created_at: string;
}

export interface TaxAdvantagedPlanLimit {
  tax_advantaged_category_id: string;
  year: number;
  contribution_limit: number;
  withdrawal_limit: number | null;
  accrued_contributions: number;
  accrued_withdrawals: number;
}

export interface CreateTaxAdvantagedPlanPayload {
  name: string;
  tax_treatment: TaxTreatment;
  currency: string;
  lifetime_contribution_limit: number | null;
  accrued_contributions?: number;
  group_id?: string | null;
}

export interface UpdateTaxAdvantagedPlanPayload {
  name?: string;
  tax_treatment?: TaxTreatment;
  lifetime_contribution_limit?: number | null;
  accrued_contributions?: number;
  group_id?: string | null;
}

export interface CreateTaxAdvantagedPlanLimitPayload {
  planId: string;
  year: number;
  contribution_limit: number;
  withdrawal_limit: number | null;
  accrued_contributions?: number;
  accrued_withdrawals?: number;
}

export interface UpdateTaxAdvantagedPlanLimitPayload {
  planId: string;
  year: number;
  contribution_limit?: number;
  withdrawal_limit?: number | null;
  accrued_contributions?: number;
  accrued_withdrawals?: number;
}

/**
 * Updates cached tax-advantaged plan list and detail entries
 */
function upsertTaxAdvantagedPlan(queryClient: QueryClient, plan: TaxAdvantagedPlan) {
  queryClient.setQueryData(taxAdvantagedPlanKeys.detail(plan.id), plan);
  queryClient.setQueryData<TaxAdvantagedPlan[]>(taxAdvantagedPlanKeys.list(), (plans) => {
    if (!plans) return [plan];
    const index = plans.findIndex((item) => item.id === plan.id);
    if (index === -1) return [...plans, plan];
    return plans.map((item) => (item.id === plan.id ? plan : item));
  });
}

/**
 * Invalidates contribution rollups after plan or limit changes
 */
function refreshTaxAdvantagedPlanSummary(queryClient: QueryClient, planId: string) {
  invalidateTaxPlans(queryClient, [planId]);
  invalidateTaxPlanOverview(queryClient);
}

/**
 * Updates cached yearly limit entries for one tax-advantaged plan
 */
function upsertTaxAdvantagedPlanLimit(
  queryClient: QueryClient,
  limit: TaxAdvantagedPlanLimit,
) {
  queryClient.setQueryData<TaxAdvantagedPlanLimit[]>(
    taxAdvantagedPlanKeys.limits(limit.tax_advantaged_category_id),
    (limits) => {
      if (!limits) return [limit];
      const index = limits.findIndex((item) => item.year === limit.year);
      if (index === -1) return [...limits, limit];
      return limits.map((item) => (item.year === limit.year ? limit : item));
    },
  );
}

/**
 * Refreshes yearly limits and contribution rollups after limit mutations
 */
function refreshTaxAdvantagedPlanLimitCaches(queryClient: QueryClient, planId: string) {
  refreshTaxAdvantagedPlanSummary(queryClient, planId);
  queryClient.invalidateQueries({ queryKey: taxAdvantagedPlanKeys.limits(planId), exact: true });
}

/**
 * Removes one cached yearly limit after a successful delete
 */
function removeTaxAdvantagedPlanLimit(
  queryClient: QueryClient,
  planId: string,
  year: number,
) {
  queryClient.setQueryData<TaxAdvantagedPlanLimit[]>(
    taxAdvantagedPlanKeys.limits(planId),
    (limits) => limits?.filter((limit) => limit.year !== year),
  );
}

/**
 * Clears tax-plan links from cached accounts after a plan is deleted
 */
function clearLinkedAccountPlanCaches(queryClient: QueryClient, planId: string) {
  const accounts = queryClient.getQueryData<AccountsOverview[]>(accountKeys.list()) ?? [];
  const linkedAccountIds = accounts
    .filter((account) => account.tax_advantaged_category_id === planId)
    .map((account) => account.id);

  queryClient.setQueryData<AccountsOverview[]>(
    accountKeys.list(),
    (currentAccounts) =>
      currentAccounts?.map((account) =>
        account.tax_advantaged_category_id === planId
          ? { ...account, tax_advantaged_category_id: null }
          : account,
      ),
  );

  for (const accountId of linkedAccountIds) {
    queryClient.setQueryData<Account>(accountKeys.detail(accountId), (account) =>
      account?.tax_advantaged_category_id === planId
        ? { ...account, tax_advantaged_category_id: null }
        : account,
    );
  }

  queryClient.invalidateQueries({ queryKey: accountKeys.list(), exact: true });
  invalidateTaxPlanOverview(queryClient);
}

/**
 * Fetches tax-advantaged plan summaries
 */
export function fetchTaxAdvantagedPlans() {
  return authenticatedFetch<TaxAdvantagedPlan[]>('/tax-advantaged-categories');
}

export function useTaxAdvantagedPlans() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: taxAdvantagedPlanKeys.list(),
    queryFn: fetchTaxAdvantagedPlans,
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Creates a tax-advantaged plan
 */
export function createTaxAdvantagedPlan(payload: CreateTaxAdvantagedPlanPayload) {
  return authenticatedFetch<TaxAdvantagedPlan>('/tax-advantaged-categories', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function useCreateTaxAdvantagedPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTaxAdvantagedPlan,
    onSuccess: (plan) => {
      upsertTaxAdvantagedPlan(queryClient, plan);
      invalidateTaxPlanOverview(queryClient);
    },
  });
}

/**
 * Updates mutable tax-advantaged plan fields
 */
export function updateTaxAdvantagedPlan(planId: string, payload: UpdateTaxAdvantagedPlanPayload) {
  return authenticatedFetch<TaxAdvantagedPlan>(`/tax-advantaged-categories/${planId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function useUpdateTaxAdvantagedPlan(planId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateTaxAdvantagedPlanPayload) =>
      updateTaxAdvantagedPlan(planId, payload),
    onSuccess: (plan) => {
      upsertTaxAdvantagedPlan(queryClient, plan);
      invalidateTaxPlanOverview(queryClient);
    },
  });
}

/**
 * Deletes a tax-advantaged plan
 */
export function deleteTaxAdvantagedPlan(planId: string) {
  return authenticatedFetch<void>(`/tax-advantaged-categories/${planId}`, {
    method: 'DELETE',
  });
}

export function useDeleteTaxAdvantagedPlan({ minimumPendingMs = 0 }: { minimumPendingMs?: number } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (planId: string) =>
      runWithMinimumPendingTime(minimumPendingMs, () => deleteTaxAdvantagedPlan(planId)),
    onSuccess: (_data, planId) => {
      queryClient.setQueryData<TaxAdvantagedPlan[]>(
        taxAdvantagedPlanKeys.list(),
        (plans) => plans?.filter((plan) => plan.id !== planId),
      );
      queryClient.removeQueries({ queryKey: taxAdvantagedPlanKeys.detail(planId), exact: true });
      queryClient.removeQueries({ queryKey: taxAdvantagedPlanKeys.limits(planId), exact: true });
      clearLinkedAccountPlanCaches(queryClient, planId);
    },
  });
}

/**
 * Fetches yearly limits for one tax-advantaged plan
 */
export function fetchTaxAdvantagedPlanLimits(planId: string | undefined) {
  return authenticatedFetch<TaxAdvantagedPlanLimit[]>(
    `/tax-advantaged-categories/${planId}/limits`,
  );
}

export function useTaxAdvantagedPlanLimits(planId: string | undefined) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: taxAdvantagedPlanKeys.limits(planId),
    queryFn: () => fetchTaxAdvantagedPlanLimits(planId),
    enabled: !!accessToken && !!planId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Creates a yearly limit under a tax-advantaged plan
 */
export function createTaxAdvantagedPlanLimit({
  planId,
  ...payload
}: CreateTaxAdvantagedPlanLimitPayload) {
  return authenticatedFetch<TaxAdvantagedPlanLimit>(`/tax-advantaged-categories/${planId}/limits`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function useCreateTaxAdvantagedPlanLimit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTaxAdvantagedPlanLimit,
    onSuccess: (limit, variables) => {
      upsertTaxAdvantagedPlanLimit(queryClient, limit);
      refreshTaxAdvantagedPlanSummary(queryClient, variables.planId);
    },
  });
}

/**
 * Updates a yearly limit under a tax-advantaged plan
 */
export function updateTaxAdvantagedPlanLimit({
  planId,
  year,
  ...payload
}: UpdateTaxAdvantagedPlanLimitPayload) {
  return authenticatedFetch<TaxAdvantagedPlanLimit>(
    `/tax-advantaged-categories/${planId}/limits/${year}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );
}

export function useUpdateTaxAdvantagedPlanLimit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateTaxAdvantagedPlanLimit,
    onSuccess: (limit, variables) => {
      upsertTaxAdvantagedPlanLimit(queryClient, limit);
      refreshTaxAdvantagedPlanSummary(queryClient, variables.planId);
    },
  });
}

/**
 * Deletes a yearly limit from a tax-advantaged plan
 */
export function deleteTaxAdvantagedPlanLimit({ planId, year }: { planId: string; year: number }) {
  return authenticatedFetch<void>(`/tax-advantaged-categories/${planId}/limits/${year}`, {
    method: 'DELETE',
  });
}

export function useDeleteTaxAdvantagedPlanLimit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteTaxAdvantagedPlanLimit,
    onSuccess: (_data, variables) => {
      removeTaxAdvantagedPlanLimit(queryClient, variables.planId, variables.year);
      refreshTaxAdvantagedPlanLimitCaches(queryClient, variables.planId);
    },
  });
}

/**
 * Fetches one tax-advantaged plan by ID
 */
export function fetchTaxAdvantagedPlan(planId: string | null | undefined) {
  return authenticatedFetch<TaxAdvantagedPlan>(`/tax-advantaged-categories/${planId}`);
}

export function useTaxAdvantagedPlan(planId: string | null | undefined) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: taxAdvantagedPlanKeys.detail(planId),
    queryFn: () => fetchTaxAdvantagedPlan(planId),
    enabled: !!accessToken && !!planId,
    staleTime: 5 * 60 * 1000,
  });
}
