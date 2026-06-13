import type { QueryClient } from '@tanstack/react-query';
import {
  invalidateTaxAdvantagedCategories,
  invalidateTaxAdvantagedCategoryOverview,
} from '@/api/cache/invalidation';
import { accountKeys, taxAdvantagedCategoryKeys } from '@/api/cache/queryKeys';
import type { Account, AccountsOverview } from '@/api/accounts';
import type {
  TaxAdvantagedCategory,
  TaxAdvantagedCategoryLimit,
} from '@/api/taxAdvantagedCategories/types';

/**
 * Updates cached tax-advantaged category list and detail entries
 */
function upsertTaxAdvantagedCategory(queryClient: QueryClient, category: TaxAdvantagedCategory) {
  queryClient.setQueryData(taxAdvantagedCategoryKeys.detail(category.id), category);
  queryClient.setQueryData<TaxAdvantagedCategory[]>(
    taxAdvantagedCategoryKeys.list(),
    (categories) => {
      if (!categories) return [category];
      const index = categories.findIndex((item) => item.id === category.id);
      if (index === -1) return [...categories, category];
      return categories.map((item) => (item.id === category.id ? category : item));
    },
  );
}

/**
 * Updates cached category entries and refreshes account-linked overview totals
 */
export function updateTaxAdvantagedCategoryCaches(
  queryClient: QueryClient,
  category: TaxAdvantagedCategory,
) {
  upsertTaxAdvantagedCategory(queryClient, category);
  invalidateTaxAdvantagedCategoryOverview(queryClient);
}

/**
 * Invalidates contribution rollups after category or limit changes
 */
export function refreshTaxAdvantagedCategorySummary(
  queryClient: QueryClient,
  categoryId: string,
) {
  invalidateTaxAdvantagedCategories(queryClient, [categoryId]);
  invalidateTaxAdvantagedCategoryOverview(queryClient);
}

/**
 * Updates cached yearly limit entries for one tax-advantaged category
 */
export function upsertTaxAdvantagedCategoryLimit(
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
export function refreshTaxAdvantagedCategoryLimitCaches(
  queryClient: QueryClient,
  categoryId: string,
) {
  refreshTaxAdvantagedCategorySummary(queryClient, categoryId);
  queryClient.invalidateQueries({
    queryKey: taxAdvantagedCategoryKeys.limits(categoryId),
    exact: true,
  });
}

/**
 * Removes one cached yearly limit after a successful delete
 */
export function removeTaxAdvantagedCategoryLimit(
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
 * Clears tax-advantaged category links from cached accounts after a category is deleted
 */
function clearLinkedAccountTaxAdvantagedCategoryCaches(
  queryClient: QueryClient,
  categoryId: string,
) {
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
 * Removes cached category data and unlinks cached accounts after a category delete succeeds
 */
export function removeTaxAdvantagedCategoryCaches(
  queryClient: QueryClient,
  categoryId: string,
) {
  queryClient.setQueryData<TaxAdvantagedCategory[]>(
    taxAdvantagedCategoryKeys.list(),
    (categories) => categories?.filter((category) => category.id !== categoryId),
  );
  queryClient.removeQueries({
    queryKey: taxAdvantagedCategoryKeys.detail(categoryId),
    exact: true,
  });
  queryClient.removeQueries({
    queryKey: taxAdvantagedCategoryKeys.limits(categoryId),
    exact: true,
  });
  clearLinkedAccountTaxAdvantagedCategoryCaches(queryClient, categoryId);
}
