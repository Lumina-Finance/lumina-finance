import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCachedAccount,
  invalidateAccountAggregateData,
  invalidateAccountCreditData,
  invalidateAccountTaxPlanData,
  invalidateCreatedAccountData,
  updateCachedAccountList,
} from '@/api/accounts/cache';
import {
  createAccount,
  deleteAccount,
  fetchAccount,
  fetchAccountCashFlow,
  fetchAccountSnapshots,
  fetchAccountSpendingBreakdown,
  fetchAccounts,
  updateAccount,
} from '@/api/accounts/requests';
import type {
  AccountSnapshotRange,
  AccountsOverview,
  SpendingRange,
} from '@/api/accounts/types';
import { runWithMinimumPendingTime } from '@/api/mutationFeedback';
import { accountKeys } from '@/api/queryKeys';
import { useAuth } from '@/hooks/useAuth';

/**
 * Creates accounts and refreshes account-dependent rollups
 */
export function useCreateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAccount,
    onSuccess: (account, payload) => {
      updateCachedAccountList(queryClient, account);
      invalidateCreatedAccountData(queryClient, account, payload);
    },
  });
}

/**
 * Updates accounts and refreshes only the account views affected by changed fields
 */
export function useUpdateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateAccount,
    onSuccess: (account, variables) => {
      const previousAccount = getCachedAccount(queryClient, account.id);
      const previousPlanId = previousAccount?.tax_advantaged_category_id;
      const previousIsArchived = previousAccount?.is_archived;
      const previousCreditLimit = previousAccount?.credit_limit;

      queryClient.setQueryData(accountKeys.detail(account.id), account);
      updateCachedAccountList(queryClient, account);

      if ('is_archived' in variables.payload && previousIsArchived !== account.is_archived) {
        invalidateAccountAggregateData(queryClient, account.id, account);
      }

      if (
        'credit_limit' in variables.payload
        && previousCreditLimit !== account.credit_limit
      ) {
        invalidateAccountCreditData(queryClient, account);
      }

      if (
        'tax_advantaged_category_id' in variables.payload
        && previousPlanId !== account.tax_advantaged_category_id
      ) {
        invalidateAccountTaxPlanData(queryClient, [
          previousPlanId,
          account.tax_advantaged_category_id,
        ]);
      }
    },
  });
}

/**
 * Deletes accounts and removes every cache entry scoped to the deleted account
 */
export function useDeleteAccount({ minimumPendingMs = 0 }: { minimumPendingMs?: number } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) =>
      runWithMinimumPendingTime(minimumPendingMs, () => deleteAccount(accountId)),
    onMutate: (accountId) => ({
      deletedAccount: getCachedAccount(queryClient, accountId),
    }),
    onSuccess: (_, accountId, context) => {
      queryClient.setQueryData<AccountsOverview[]>(accountKeys.list(), (accounts) =>
        accounts?.filter((account) => account.id !== accountId) ?? accounts,
      );
      queryClient.removeQueries({ queryKey: accountKeys.accountScope(accountId) });
      invalidateAccountAggregateData(queryClient, accountId, context?.deletedAccount);
    },
  });
}

/**
 * Reads account overview rows for lists and selectors
 */
export function useAccounts() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: accountKeys.list(),
    queryFn: fetchAccounts,
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Reads one account detail record
 */
export function useAccount(accountId: string | undefined) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: accountKeys.detail(accountId),
    queryFn: () => fetchAccount(accountId),
    enabled: !!accessToken && !!accountId,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Reads balance snapshots for account detail charts
 */
export function useAccountSnapshots(
  accountId: string | undefined,
  range: AccountSnapshotRange = {},
) {
  const { accessToken } = useAuth();
  const { fromDate, toDate, granularity = 'day', includeAnchor = false } = range;
  return useQuery({
    queryKey: accountKeys.snapshots(accountId, {
      fromDate,
      toDate,
      granularity,
      includeAnchor,
    }),
    queryFn: () => fetchAccountSnapshots(accountId, range),
    enabled: !!accessToken && !!accountId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Reads account spending cards for a backend-defined calendar range
 */
export function useAccountSpendingBreakdown(
  accountId: string | undefined,
  range: SpendingRange,
) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: accountKeys.spendingBreakdown(accountId, range),
    queryFn: () => fetchAccountSpendingBreakdown(accountId, range),
    enabled: !!accessToken && !!accountId,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === accountId ? previousData : undefined,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Reads monthly account cash-flow totals for the detail chart
 */
export function useAccountCashFlow(accountId: string | undefined, months: number = 6) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: accountKeys.cashFlow(accountId, months),
    queryFn: () => fetchAccountCashFlow(accountId, months),
    enabled: !!accessToken && !!accountId,
    staleTime: 5 * 60 * 1000,
  });
}
