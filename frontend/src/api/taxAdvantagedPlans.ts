import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { authenticatedFetch } from '@/api/client';

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

export function useTaxAdvantagedPlans() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ['tax-advantaged-plans'],
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-advantaged-plans'] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-advantaged-plans'] });
      queryClient.invalidateQueries({ queryKey: ['tax-advantaged-plans', planId] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-advantaged-plans'] });
    },
  });
}

export function useTaxAdvantagedPlanLimits(planId: string | undefined) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ['tax-advantaged-plans', planId, 'limits'],
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
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tax-advantaged-plans'] });
      queryClient.invalidateQueries({ queryKey: ['tax-advantaged-plans', variables.planId] });
      queryClient.invalidateQueries({ queryKey: ['tax-advantaged-plans', variables.planId, 'limits'] });
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
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tax-advantaged-plans'] });
      queryClient.invalidateQueries({ queryKey: ['tax-advantaged-plans', variables.planId] });
      queryClient.invalidateQueries({ queryKey: ['tax-advantaged-plans', variables.planId, 'limits'] });
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
      queryClient.invalidateQueries({ queryKey: ['tax-advantaged-plans'] });
      queryClient.invalidateQueries({ queryKey: ['tax-advantaged-plans', variables.planId] });
      queryClient.invalidateQueries({ queryKey: ['tax-advantaged-plans', variables.planId, 'limits'] });
    },
  });
}

export function useTaxAdvantagedPlan(planId: string | null | undefined) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ['tax-advantaged-plans', planId],
    queryFn: () => authenticatedFetch<TaxAdvantagedPlan>(`/tax-advantaged-plans/${planId}`),
    enabled: !!accessToken && !!planId,
    staleTime: 5 * 60 * 1000,
  });
}
