import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { authenticatedFetch } from '@/api/client';
import { accountKeys, taxAdvantagedPlanKeys } from '@/api/queryKeys';
import type { Account, AccountsOverview } from '@/api/accounts';

export type TaxTreatment = 'tax_free' | 'tax_deferred' | 'tax_assisted';

export interface TaxAdvantagedPlan {
  id: string;
  plan_owner_user_id: string;
  group_id: string | null;
  name: string;
  tax_treatment: TaxTreatment;
  currency: string;
  lifetime_contribution_limit: number | null;
  current_year_contribution_limit: number | null;
  current_year_withdrawal_limit: number | null;
  ytd_contributions: number;
  ytd_withdrawals: number;
  lifetime_contributions: number;
  lifetime_withdrawals: number;
  created_at: string;
}

export interface TaxAdvantagedPlanLimit {
  plan_id: string;
  year: number;
  contribution_limit: number;
  withdrawal_limit: number | null;
}

export interface CreateTaxAdvantagedPlanPayload {
  name: string;
  tax_treatment: TaxTreatment;
  currency: string;
  lifetime_contribution_limit: number | null;
  group_id?: string | null;
}

export interface UpdateTaxAdvantagedPlanPayload {
  name?: string;
  tax_treatment?: TaxTreatment;
  lifetime_contribution_limit?: number | null;
  group_id?: string | null;
}

export interface CreateTaxAdvantagedPlanLimitPayload {
  planId: string;
  year: number;
  contribution_limit: number;
  withdrawal_limit: number | null;
}

export interface UpdateTaxAdvantagedPlanLimitPayload {
  planId: string;
  year: number;
  contribution_limit?: number;
  withdrawal_limit?: number | null;
}

function upsertTaxAdvantagedPlan(queryClient: QueryClient, plan: TaxAdvantagedPlan) {
  queryClient.setQueryData(taxAdvantagedPlanKeys.detail(plan.id), plan);
  queryClient.setQueryData<TaxAdvantagedPlan[]>(taxAdvantagedPlanKeys.list(), (plans) => {
    if (!plans) return [plan];
    const index = plans.findIndex((item) => item.id === plan.id);
    if (index === -1) return [...plans, plan];
    return plans.map((item) => (item.id === plan.id ? plan : item));
  });
}

function refreshTaxAdvantagedPlanSummary(queryClient: QueryClient, planId: string) {
  queryClient.invalidateQueries({ queryKey: taxAdvantagedPlanKeys.list(), exact: true });
  queryClient.invalidateQueries({ queryKey: taxAdvantagedPlanKeys.detail(planId), exact: true });
}

function upsertTaxAdvantagedPlanLimit(
  queryClient: QueryClient,
  limit: TaxAdvantagedPlanLimit,
) {
  queryClient.setQueryData<TaxAdvantagedPlanLimit[]>(
    taxAdvantagedPlanKeys.limits(limit.plan_id),
    (limits) => {
      if (!limits) return [limit];
      const index = limits.findIndex((item) => item.year === limit.year);
      if (index === -1) return [...limits, limit];
      return limits.map((item) => (item.year === limit.year ? limit : item));
    },
  );
}

function refreshTaxAdvantagedPlanLimitCaches(queryClient: QueryClient, planId: string) {
  refreshTaxAdvantagedPlanSummary(queryClient, planId);
  queryClient.invalidateQueries({ queryKey: taxAdvantagedPlanKeys.limits(planId), exact: true });
}

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

function clearLinkedAccountPlanCaches(queryClient: QueryClient, planId: string) {
  const accounts = queryClient.getQueryData<AccountsOverview[]>(accountKeys.list()) ?? [];
  const linkedAccountIds = accounts
    .filter((account) => account.tax_advantaged_plan_id === planId)
    .map((account) => account.id);

  queryClient.setQueryData<AccountsOverview[]>(
    accountKeys.list(),
    (currentAccounts) =>
      currentAccounts?.map((account) =>
        account.tax_advantaged_plan_id === planId
          ? { ...account, tax_advantaged_plan_id: null }
          : account,
      ),
  );

  for (const accountId of linkedAccountIds) {
    queryClient.setQueryData<Account>(accountKeys.detail(accountId), (account) =>
      account?.tax_advantaged_plan_id === planId
        ? { ...account, tax_advantaged_plan_id: null }
        : account,
    );
  }

  queryClient.invalidateQueries({ queryKey: accountKeys.list(), exact: true });
}

export function useTaxAdvantagedPlans() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: taxAdvantagedPlanKeys.list(),
    queryFn: () => authenticatedFetch<TaxAdvantagedPlan[]>('/tax-advantaged-plans'),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

export function useCreateTaxAdvantagedPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateTaxAdvantagedPlanPayload) =>
      authenticatedFetch<TaxAdvantagedPlan>('/tax-advantaged-plans', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (plan) => {
      upsertTaxAdvantagedPlan(queryClient, plan);
    },
  });
}

export function useUpdateTaxAdvantagedPlan(planId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateTaxAdvantagedPlanPayload) =>
      authenticatedFetch<TaxAdvantagedPlan>(`/tax-advantaged-plans/${planId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: (plan) => {
      upsertTaxAdvantagedPlan(queryClient, plan);
    },
  });
}

export function useDeleteTaxAdvantagedPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (planId: string) =>
      authenticatedFetch<void>(`/tax-advantaged-plans/${planId}`, {
        method: 'DELETE',
      }),
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

export function useTaxAdvantagedPlanLimits(planId: string | undefined) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: taxAdvantagedPlanKeys.limits(planId),
    queryFn: () => authenticatedFetch<TaxAdvantagedPlanLimit[]>(`/tax-advantaged-plans/${planId}/limits`),
    enabled: !!accessToken && !!planId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateTaxAdvantagedPlanLimit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, ...payload }: CreateTaxAdvantagedPlanLimitPayload) =>
      authenticatedFetch<TaxAdvantagedPlanLimit>(`/tax-advantaged-plans/${planId}/limits`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (limit, variables) => {
      upsertTaxAdvantagedPlanLimit(queryClient, limit);
      refreshTaxAdvantagedPlanSummary(queryClient, variables.planId);
    },
  });
}

export function useUpdateTaxAdvantagedPlanLimit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, year, ...payload }: UpdateTaxAdvantagedPlanLimitPayload) =>
      authenticatedFetch<TaxAdvantagedPlanLimit>(`/tax-advantaged-plans/${planId}/limits/${year}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: (limit, variables) => {
      upsertTaxAdvantagedPlanLimit(queryClient, limit);
      refreshTaxAdvantagedPlanSummary(queryClient, variables.planId);
    },
  });
}

export function useDeleteTaxAdvantagedPlanLimit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, year }: { planId: string; year: number }) =>
      authenticatedFetch<void>(`/tax-advantaged-plans/${planId}/limits/${year}`, {
        method: 'DELETE',
      }),
    onSuccess: (_data, variables) => {
      removeTaxAdvantagedPlanLimit(queryClient, variables.planId, variables.year);
      refreshTaxAdvantagedPlanLimitCaches(queryClient, variables.planId);
    },
  });
}

export function useTaxAdvantagedPlan(planId: string | null | undefined) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: taxAdvantagedPlanKeys.detail(planId),
    queryFn: () => authenticatedFetch<TaxAdvantagedPlan>(`/tax-advantaged-plans/${planId}`),
    enabled: !!accessToken && !!planId,
    staleTime: 5 * 60 * 1000,
  });
}
