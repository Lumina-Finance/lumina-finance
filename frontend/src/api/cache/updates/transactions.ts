import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import {
  invalidateAccountActivity,
  invalidateAccountBalances,
  invalidateAccounts,
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
  invalidateTaxAdvantagedCategories,
  invalidateTransactionOverview as invalidateTransactionOverviewQueries,
  invalidateTransactions,
} from '@/api/cache/invalidation';
import { accountKeys, transactionKeys } from '@/api/cache/queryKeys';
import type { Account, AccountKind, AccountsOverview } from '@/api/accounts/types';
import type { Transaction, UpdateTransactionPayload } from '@/api/transactions/types';

const TRANSACTION_LIST_FIELDS = new Set<keyof UpdateTransactionPayload>([
  'account_id',
  'dt',
  'category_id',
  'amount',
  'merchant_id',
  'notes',
  'tag_ids',
]);

const TRANSACTION_OVERVIEW_FIELDS = new Set<keyof UpdateTransactionPayload>([
  'account_id',
  'dt',
  'category_id',
  'amount',
  'merchant_id',
  'notes',
]);

const ACCOUNT_BALANCE_FIELDS = new Set<keyof UpdateTransactionPayload>([
  'account_id',
  'dt',
  'amount',
]);

const ACCOUNT_ACTIVITY_FIELDS = new Set<keyof UpdateTransactionPayload>([
  'account_id',
  'dt',
  'category_id',
  'amount',
]);

const DASHBOARD_RECENT_FIELDS = new Set<keyof UpdateTransactionPayload>([
  'account_id',
  'dt',
  'category_id',
  'amount',
  'merchant_id',
]);

const INCOME_EXPENSE_FIELDS = new Set<keyof UpdateTransactionPayload>([
  'account_id',
  'dt',
  'category_id',
  'amount',
]);

const CREDIT_ACTIVITY_FIELDS = new Set<keyof UpdateTransactionPayload>([
  'account_id',
  'amount',
]);

const MERCHANT_ACTIVITY_FIELDS = new Set<keyof UpdateTransactionPayload>([
  'merchant_id',
]);

function patchTouches(
  patch: UpdateTransactionPayload,
  fields: Set<keyof UpdateTransactionPayload>,
): boolean {
  return Object.keys(patch).some((key) => fields.has(key as keyof UpdateTransactionPayload));
}

export function uniqueIds(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => !!id))];
}

/**
 * Checks React Query results before reading infinite transaction pages
 */
function isInfiniteTransactionsData(data: unknown): data is InfiniteData<Transaction[]> {
  return (
    typeof data === 'object'
    && data !== null
    && 'pages' in data
    && Array.isArray((data as InfiniteData<Transaction[]>).pages)
  );
}

/**
 * Finds a transaction in any cached list so mutations can invalidate both old and new account scopes
 */
export function findCachedTransaction(
  queryClient: QueryClient,
  transactionId: string,
): Transaction | undefined {
  const transactionQueries = queryClient.getQueriesData<Transaction[] | InfiniteData<Transaction[]>>({
    queryKey: transactionKeys.all,
    exact: false,
  });

  for (const [, data] of transactionQueries) {
    if (!data) continue;
    if (isInfiniteTransactionsData(data)) {
      const transaction = data.pages.flat().find((item) => item.id === transactionId);
      if (transaction) return transaction;
    } else {
      const transaction = data.find((item) => item.id === transactionId);
      if (transaction) return transaction;
    }
  }
  return undefined;
}

/**
 * Drops a transaction from every cached list right away so a deletion clears from the screen at once
 * instead of lingering until the refetch that invalidation schedules
 */
export function removeTransactionFromLists(
  queryClient: QueryClient,
  transactionId: string,
): void {
  const transactionQueries = queryClient.getQueriesData<Transaction[] | InfiniteData<Transaction[]>>({
    queryKey: transactionKeys.all,
    exact: false,
  });

  for (const [queryKey, data] of transactionQueries) {
    if (!data) continue;
    if (isInfiniteTransactionsData(data)) {
      queryClient.setQueryData<InfiniteData<Transaction[]>>(queryKey, {
        ...data,
        pages: data.pages.map((page) => page.filter((item) => item.id !== transactionId)),
      });
    } else if (Array.isArray(data)) {
      queryClient.setQueryData<Transaction[]>(queryKey, data.filter((item) => item.id !== transactionId));
    }
  }
}

/**
 * Reads cached account plan links without triggering a network request during invalidation
 */
function getCachedAccountTaxAdvantagedCategoryId(
  queryClient: QueryClient,
  accountId: string,
): string | null | undefined {
  const detail = queryClient.getQueryData<Account>(accountKeys.detail(accountId));
  if (detail) return detail.tax_advantaged_category_id;

  const accounts = queryClient.getQueryData<AccountsOverview[]>(accountKeys.list());
  return accounts?.find((account) => account.id === accountId)?.tax_advantaged_category_id;
}

/**
 * Reads cached account kind so credit widgets only refresh when credit accounts may be affected
 */
function getCachedAccountKind(
  queryClient: QueryClient,
  accountId: string,
): AccountKind | undefined {
  const detail = queryClient.getQueryData<Account>(accountKeys.detail(accountId));
  if (detail) return detail.account_kind;

  const accounts = queryClient.getQueryData<AccountsOverview[]>(accountKeys.list());
  return accounts?.find((account) => account.id === accountId)?.account_kind;
}

export interface AccountActivityInvalidationOptions {
  refetchAccountList?: boolean;
}

/**
 * Invalidates exact account balances when account IDs are known, or falls back to the account list
 */
function invalidateTransactionAccountBalances(queryClient: QueryClient, accountIds: string[]) {
  if (accountIds.length > 0) {
    invalidateAccountBalances(queryClient, accountIds);
    return;
  }

  invalidateAccounts(queryClient);
}

/**
 * Invalidates exact account activity when account IDs are known, or falls back to the account list
 */
function invalidateTransactionAccountActivity(queryClient: QueryClient, accountIds: string[]) {
  if (accountIds.length > 0) {
    invalidateAccountActivity(queryClient, accountIds);
    return;
  }

  invalidateAccounts(queryClient);
}

/**
 * Refreshes credit data only when changed transactions could affect revolving accounts
 */
function invalidateCreditActivity(queryClient: QueryClient, accountIds: string[]) {
  const mayAffectCredit = accountIds.length === 0
    || accountIds.some((accountId) => {
      const accountKind = getCachedAccountKind(queryClient, accountId);
      return accountKind === undefined || accountKind === 'revolving';
    });

  if (mayAffectCredit) invalidateDashboardCredit(queryClient);
}

/**
 * Invalidates contribution data for tax-advantaged plans linked to changed accounts
 */
function invalidateTaxAdvantagedActivity(queryClient: QueryClient, accountIds: string[]) {
  const categoryIds = uniqueIds(
    accountIds.map((accountId) => getCachedAccountTaxAdvantagedCategoryId(queryClient, accountId)),
  );
  invalidateTaxAdvantagedCategories(queryClient, categoryIds);
}

/**
 * Invalidates account-level transaction data after external workflows create transactions
 */
export function invalidateTransactionAccountData(
  queryClient: QueryClient,
  accountIds: string[],
  options: AccountActivityInvalidationOptions = {},
) {
  if (options.refetchAccountList) invalidateTransactionAccountBalances(queryClient, accountIds);
  invalidateTransactionAccountActivity(queryClient, accountIds);
  invalidateTaxAdvantagedActivity(queryClient, accountIds);
}

export interface FinancialTransactionInvalidationOptions {
  deferAccountInvalidation?: boolean;
  // Holds the transaction overview refresh for the caller to flush, so an open create modal does not
  // refetch the transactions page behind it on every save
  deferTransactionOverview?: boolean;
}

/**
 * Invalidates aggregate views affected by created or deleted financial transactions
 */
export function invalidateFinancialTransactionData(
  queryClient: QueryClient,
  accountIds: string[],
  options: FinancialTransactionInvalidationOptions = {},
) {
  if (!options.deferTransactionOverview) invalidateTransactionOverviewQueries(queryClient);
  invalidateDashboardBalance(queryClient);
  invalidateDashboardIncomeExpense(queryClient);
  invalidateDashboardRecent(queryClient);
  invalidateInsightsBalance(queryClient);
  invalidateInsightsIncomeExpense(queryClient);
  invalidateBudgets(queryClient);
  invalidateDashboardBudgets(queryClient);
  invalidateRunway(queryClient);
  if (!options.deferAccountInvalidation) {
    invalidateTransactionAccountBalances(queryClient, accountIds);
    invalidateTransactionAccountActivity(queryClient, accountIds);
    invalidateTaxAdvantagedActivity(queryClient, accountIds);
    invalidateCreditActivity(queryClient, accountIds);
  }
}

/**
 * Invalidates only the cached views whose inputs changed in a transaction patch
 */
export function invalidatePatchedTransactionData(
  queryClient: QueryClient,
  patch: UpdateTransactionPayload,
  accountIds: string[],
) {
  if (patchTouches(patch, TRANSACTION_LIST_FIELDS)) invalidateTransactions(queryClient);
  if (patchTouches(patch, TRANSACTION_OVERVIEW_FIELDS)) invalidateTransactionOverviewQueries(queryClient);
  if (patchTouches(patch, ACCOUNT_BALANCE_FIELDS)) {
    invalidateTransactionAccountBalances(queryClient, accountIds);
    invalidateDashboardBalance(queryClient);
    invalidateInsightsBalance(queryClient);
  }
  if (patchTouches(patch, ACCOUNT_ACTIVITY_FIELDS)) {
    invalidateTransactionAccountActivity(queryClient, accountIds);
  }
  if (patchTouches(patch, DASHBOARD_RECENT_FIELDS)) invalidateDashboardRecent(queryClient);
  if (patchTouches(patch, INCOME_EXPENSE_FIELDS)) {
    invalidateDashboardIncomeExpense(queryClient);
    invalidateInsightsIncomeExpense(queryClient);
    invalidateBudgets(queryClient);
    invalidateDashboardBudgets(queryClient);
    invalidateRunway(queryClient);
    invalidateTaxAdvantagedActivity(queryClient, accountIds);
  }
  if (patchTouches(patch, CREDIT_ACTIVITY_FIELDS)) invalidateCreditActivity(queryClient, accountIds);
  if (patchTouches(patch, MERCHANT_ACTIVITY_FIELDS)) invalidateInsightsMerchants(queryClient);
}
