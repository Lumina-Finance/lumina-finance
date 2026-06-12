import type { QueryClient } from '@tanstack/react-query';
import {
  invalidateAccountBalances,
  invalidateAccountData,
  invalidateBudgets,
  invalidateDashboardBalance,
  invalidateDashboardBudgets,
  invalidateDashboardCredit,
  invalidateDashboardIncomeExpense,
  invalidateDashboardRecent,
  invalidateInsightsBalance,
  invalidateInsightsIncomeExpense,
  invalidateInsightsMerchants,
  invalidateRunway,
  invalidateRunwaySettings,
  invalidateTaxAdvantagedCategoryOverview,
  invalidateTaxAdvantagedCategories,
  invalidateTransactionOverview,
  invalidateTransactions,
} from '@/api/cacheInvalidation';
import { accountKeys } from '@/api/queryKeys';
import type { Account, AccountsOverview, CreateAccountPayload } from '@/api/accounts/types';

/**
 * Updates cached list rows after account create or update responses
 */
export function updateCachedAccountList(queryClient: QueryClient, account: AccountsOverview) {
  queryClient.setQueryData<AccountsOverview[]>(accountKeys.list(), (accounts) => {
    if (!accounts) return [account];
    const index = accounts.findIndex((item) => item.id === account.id);
    if (index === -1) return [...accounts, account];
    return accounts.map((item) => (item.id === account.id ? account : item));
  });
}

/**
 * Reads a cached account from detail first, then falls back to the list row
 */
export function getCachedAccount(queryClient: QueryClient, accountId: string) {
  const detail = queryClient.getQueryData<Account>(accountKeys.detail(accountId));
  if (detail) return detail;

  const accounts = queryClient.getQueryData<AccountsOverview[]>(accountKeys.list());
  return accounts?.find((account) => account.id === accountId);
}

function isRevolvingAccount(account: Pick<AccountsOverview, 'account_kind'> | undefined) {
  return account === undefined || account.account_kind === 'revolving';
}

/**
 * Invalidates credit widgets only when a changed account may affect revolving credit
 */
export function invalidateAccountCreditData(
  queryClient: QueryClient,
  account: Pick<AccountsOverview, 'account_kind'> | undefined,
) {
  if (isRevolvingAccount(account)) invalidateDashboardCredit(queryClient);
}

/**
 * Invalidates tax-plan rollups for known plan IDs or all plans when the previous link is unknown
 */
export function invalidateAccountTaxAdvantagedCategoryData(
  queryClient: QueryClient,
  categoryIds: Array<string | null | undefined>,
) {
  const knownCategoryIds = categoryIds.filter((categoryId): categoryId is string => !!categoryId);
  const hasUnknownCategory = categoryIds.some((categoryId) => categoryId === undefined);
  if (knownCategoryIds.length === 0 && !hasUnknownCategory) return;

  invalidateTaxAdvantagedCategories(queryClient, knownCategoryIds);
  invalidateTaxAdvantagedCategoryOverview(queryClient);
}

/**
 * Invalidates all aggregate views that depend on account activity or account visibility
 */
export function invalidateAccountAggregateData(
  queryClient: QueryClient,
  accountId: string,
  account: Pick<AccountsOverview, 'account_kind' | 'tax_advantaged_category_id'> | undefined,
) {
  invalidateAccountData(queryClient, [accountId]);
  invalidateTransactions(queryClient);
  invalidateTransactionOverview(queryClient);
  invalidateDashboardBalance(queryClient);
  invalidateDashboardIncomeExpense(queryClient);
  invalidateDashboardRecent(queryClient);
  invalidateAccountCreditData(queryClient, account);
  invalidateInsightsBalance(queryClient);
  invalidateInsightsIncomeExpense(queryClient);
  invalidateInsightsMerchants(queryClient);
  invalidateBudgets(queryClient);
  invalidateDashboardBudgets(queryClient);
  invalidateRunwaySettings(queryClient);
  invalidateAccountTaxAdvantagedCategoryData(queryClient, [account?.tax_advantaged_category_id]);
}

/**
 * Invalidates balances and rollups affected by an account created with a starting balance
 */
export function invalidateCreatedAccountData(
  queryClient: QueryClient,
  account: AccountsOverview,
  payload: CreateAccountPayload,
) {
  if (!account.is_archived && account.current_balance !== 0) {
    invalidateAccountBalances(queryClient, [account.id]);
    invalidateTransactions(queryClient);
    invalidateTransactionOverview(queryClient);
    invalidateDashboardBalance(queryClient);
    invalidateDashboardRecent(queryClient);
    invalidateInsightsBalance(queryClient);
    invalidateRunway(queryClient);
  }
  if (!account.is_archived && payload.credit_limit !== null) {
    invalidateAccountCreditData(queryClient, account);
  }
  if (account.tax_advantaged_category_id) {
    invalidateAccountTaxAdvantagedCategoryData(queryClient, [account.tax_advantaged_category_id]);
  }
}
