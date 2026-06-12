import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { authenticatedFetch } from '@/api/client';
import {
  invalidateTaxAdvantagedCategoryOverview,
  invalidateTaxAdvantagedCategories,
} from '@/api/cacheInvalidation';
import { accountKeys, taxAdvantagedCategoryKeys } from '@/api/queryKeys';
import type { Account, AccountsOverview } from '@/api/accounts';
import { runWithMinimumPendingTime } from '@/api/mutationFeedback';

export type TaxTreatment = 'tax_free' | 'tax_deferred' | 'tax_assisted';

export interface TaxAdvantagedCategory {
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

export interface TaxAdvantagedCategoryLimit {
  tax_advantaged_category_id: string;
  year: number;
  contribution_limit: number;
  withdrawal_limit: number | null;
  accrued_contributions: number;
  accrued_withdrawals: number;
}

export interface CreateTaxAdvantagedCategoryPayload {
  name: string;
  tax_treatment: TaxTreatment;
  currency: string;
  lifetime_contribution_limit: number | null;
  accrued_contributions?: number;
  group_id?: string | null;
}

export interface UpdateTaxAdvantagedCategoryPayload {
  name?: string;
  tax_treatment?: TaxTreatment;
  lifetime_contribution_limit?: number | null;
  accrued_contributions?: number;
  group_id?: string | null;
}

export interface CreateTaxAdvantagedCategoryLimitPayload {
  categoryId: string;
  year: number;
  contribution_limit: number;
  withdrawal_limit: number | null;
  accrued_contributions?: number;
  accrued_withdrawals?: number;
}

export interface UpdateTaxAdvantagedCategoryLimitPayload {
  categoryId: string;
  year: number;
  contribution_limit?: number;
  withdrawal_limit?: number | null;
  accrued_contributions?: number;
  accrued_withdrawals?: number;
}

/**
 * Updates cached tax-advantaged category list and detail entries
 */
function upsertTaxAdvantagedCategory(queryClient: QueryClient, category: TaxAdvantagedCategory) {
  queryClient.setQueryData(taxAdvantagedCategoryKeys.detail(category.id), category);
  queryClient.setQueryData<TaxAdvantagedCategory[]>(taxAdvantagedCategoryKeys.list(), (categories) => {
    if (!categories) return [category];
    const index = categories.findIndex((item) => item.id === category.id);
    if (index === -1) return [...categories, category];
    return categories.map((item) => (item.id === category.id ? category : item));
  });
}

/**
 * Invalidates contribution rollups after category or limit changes
 */
function refreshTaxAdvantagedCategorySummary(queryClient: QueryClient, categoryId: string) {
  invalidateTaxAdvantagedCategories(queryClient, [categoryId]);
  invalidateTaxAdvantagedCategoryOverview(queryClient);
}

/**
 * Updates cached yearly limit entries for one tax-advantaged category
 */
function upsertTaxAdvantagedCategoryLimit(
  queryClient: QueryClient,
  limit: TaxAdvantagedCategoryLimit,
) {
  queryClient.setQueryData<TaxAdvantagedCategoryLimit[]>(
    taxAdvantagedCategoryKeys.limits(limit.tax_advantaged_category_id),
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
function refreshTaxAdvantagedCategoryLimitCaches(queryClient: QueryClient, categoryId: string) {
  refreshTaxAdvantagedCategorySummary(queryClient, categoryId);
  queryClient.invalidateQueries({ queryKey: taxAdvantagedCategoryKeys.limits(categoryId), exact: true });
}

/**
 * Removes one cached yearly limit after a successful delete
 */
function removeTaxAdvantagedCategoryLimit(
  queryClient: QueryClient,
  categoryId: string,
  year: number,
) {
  queryClient.setQueryData<TaxAdvantagedCategoryLimit[]>(
    taxAdvantagedCategoryKeys.limits(categoryId),
    (limits) => limits?.filter((limit) => limit.year !== year),
  );
}

/**
 * Clears tax-category links from cached accounts after a category is deleted
 */
function clearLinkedAccountCategoryCaches(queryClient: QueryClient, categoryId: string) {
  const accounts = queryClient.getQueryData<AccountsOverview[]>(accountKeys.list()) ?? [];
  const linkedAccountIds = accounts
    .filter((account) => account.tax_advantaged_category_id === categoryId)
    .map((account) => account.id);

  queryClient.setQueryData<AccountsOverview[]>(
    accountKeys.list(),
    (currentAccounts) =>
      currentAccounts?.map((account) =>
        account.tax_advantaged_category_id === categoryId
          ? { ...account, tax_advantaged_category_id: null }
          : account,
      ),
  );

  for (const accountId of linkedAccountIds) {
    queryClient.setQueryData<Account>(accountKeys.detail(accountId), (account) =>
      account?.tax_advantaged_category_id === categoryId
        ? { ...account, tax_advantaged_category_id: null }
        : account,
    );
  }

  queryClient.invalidateQueries({ queryKey: accountKeys.list(), exact: true });
  invalidateTaxAdvantagedCategoryOverview(queryClient);
}

/**
 * Fetches tax-advantaged category summaries
 */
export function fetchTaxAdvantagedCategories() {
  return authenticatedFetch<TaxAdvantagedCategory[]>('/tax-advantaged-categories');
}

export function useTaxAdvantagedCategories() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: taxAdvantagedCategoryKeys.list(),
    queryFn: fetchTaxAdvantagedCategories,
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Creates a tax-advantaged category
 */
export function createTaxAdvantagedCategory(payload: CreateTaxAdvantagedCategoryPayload) {
  return authenticatedFetch<TaxAdvantagedCategory>('/tax-advantaged-categories', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function useCreateTaxAdvantagedCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTaxAdvantagedCategory,
    onSuccess: (category) => {
      upsertTaxAdvantagedCategory(queryClient, category);
      invalidateTaxAdvantagedCategoryOverview(queryClient);
    },
  });
}

/**
 * Updates mutable tax-advantaged category fields
 */
export function updateTaxAdvantagedCategory(categoryId: string, payload: UpdateTaxAdvantagedCategoryPayload) {
  return authenticatedFetch<TaxAdvantagedCategory>(`/tax-advantaged-categories/${categoryId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function useUpdateTaxAdvantagedCategory(categoryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateTaxAdvantagedCategoryPayload) =>
      updateTaxAdvantagedCategory(categoryId, payload),
    onSuccess: (category) => {
      upsertTaxAdvantagedCategory(queryClient, category);
      invalidateTaxAdvantagedCategoryOverview(queryClient);
    },
  });
}

/**
 * Deletes a tax-advantaged category
 */
export function deleteTaxAdvantagedCategory(categoryId: string) {
  return authenticatedFetch<void>(`/tax-advantaged-categories/${categoryId}`, {
    method: 'DELETE',
  });
}

export function useDeleteTaxAdvantagedCategory({ minimumPendingMs = 0 }: { minimumPendingMs?: number } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) =>
      runWithMinimumPendingTime(minimumPendingMs, () => deleteTaxAdvantagedCategory(categoryId)),
    onSuccess: (_data, categoryId) => {
      queryClient.setQueryData<TaxAdvantagedCategory[]>(
        taxAdvantagedCategoryKeys.list(),
        (categories) => categories?.filter((category) => category.id !== categoryId),
      );
      queryClient.removeQueries({ queryKey: taxAdvantagedCategoryKeys.detail(categoryId), exact: true });
      queryClient.removeQueries({ queryKey: taxAdvantagedCategoryKeys.limits(categoryId), exact: true });
      clearLinkedAccountCategoryCaches(queryClient, categoryId);
    },
  });
}

/**
 * Fetches yearly limits for one tax-advantaged category
 */
export function fetchTaxAdvantagedCategoryLimits(categoryId: string | undefined) {
  return authenticatedFetch<TaxAdvantagedCategoryLimit[]>(
    `/tax-advantaged-categories/${categoryId}/limits`,
  );
}

export function useTaxAdvantagedCategoryLimits(categoryId: string | undefined) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: taxAdvantagedCategoryKeys.limits(categoryId),
    queryFn: () => fetchTaxAdvantagedCategoryLimits(categoryId),
    enabled: !!accessToken && !!categoryId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Creates a yearly limit under a tax-advantaged category
 */
export function createTaxAdvantagedCategoryLimit({
  categoryId,
  ...payload
}: CreateTaxAdvantagedCategoryLimitPayload) {
  return authenticatedFetch<TaxAdvantagedCategoryLimit>(`/tax-advantaged-categories/${categoryId}/limits`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function useCreateTaxAdvantagedCategoryLimit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTaxAdvantagedCategoryLimit,
    onSuccess: (limit, variables) => {
      upsertTaxAdvantagedCategoryLimit(queryClient, limit);
      refreshTaxAdvantagedCategorySummary(queryClient, variables.categoryId);
    },
  });
}

/**
 * Updates a yearly limit under a tax-advantaged category
 */
export function updateTaxAdvantagedCategoryLimit({
  categoryId,
  year,
  ...payload
}: UpdateTaxAdvantagedCategoryLimitPayload) {
  return authenticatedFetch<TaxAdvantagedCategoryLimit>(
    `/tax-advantaged-categories/${categoryId}/limits/${year}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );
}

export function useUpdateTaxAdvantagedCategoryLimit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateTaxAdvantagedCategoryLimit,
    onSuccess: (limit, variables) => {
      upsertTaxAdvantagedCategoryLimit(queryClient, limit);
      refreshTaxAdvantagedCategorySummary(queryClient, variables.categoryId);
    },
  });
}

/**
 * Deletes a yearly limit from a tax-advantaged category
 */
export function deleteTaxAdvantagedCategoryLimit({ categoryId, year }: { categoryId: string; year: number }) {
  return authenticatedFetch<void>(`/tax-advantaged-categories/${categoryId}/limits/${year}`, {
    method: 'DELETE',
  });
}

export function useDeleteTaxAdvantagedCategoryLimit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteTaxAdvantagedCategoryLimit,
    onSuccess: (_data, variables) => {
      removeTaxAdvantagedCategoryLimit(queryClient, variables.categoryId, variables.year);
      refreshTaxAdvantagedCategoryLimitCaches(queryClient, variables.categoryId);
    },
  });
}

/**
 * Fetches one tax-advantaged category by ID
 */
export function fetchTaxAdvantagedCategory(categoryId: string | null | undefined) {
  return authenticatedFetch<TaxAdvantagedCategory>(`/tax-advantaged-categories/${categoryId}`);
}

export function useTaxAdvantagedCategory(categoryId: string | null | undefined) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: taxAdvantagedCategoryKeys.detail(categoryId),
    queryFn: () => fetchTaxAdvantagedCategory(categoryId),
    enabled: !!accessToken && !!categoryId,
    staleTime: 5 * 60 * 1000,
  });
}
