import type { QueryClient } from '@tanstack/react-query';
import { accountKeys } from '@/api/cache/queryKeys';
import { invalidateTargets } from '@/api/cache/invalidation/types';

/**
 * Invalidates the account list used by account summaries and selectors
 */
function invalidateAccountSummaries(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: accountKeys.list(), exact: true }]);
}

/**
 * Invalidates all account-scoped queries
 */
export function invalidateAccounts(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: accountKeys.all }]);
}

/**
 * Invalidates account balances and balance history after balance-changing mutations
 */
export function invalidateAccountBalances(queryClient: QueryClient, accountIds: string[]) {
  invalidateAccountSummaries(queryClient);
  invalidateTargets(queryClient, accountIds.flatMap((accountId) => [
    { queryKey: accountKeys.detail(accountId), exact: true },
    { queryKey: accountKeys.snapshotsAll(accountId) },
  ]));
}

/**
 * Invalidates account activity widgets after transaction changes
 */
export function invalidateAccountActivity(queryClient: QueryClient, accountIds: string[]) {
  invalidateTargets(queryClient, accountIds.flatMap((accountId) => [
    { queryKey: accountKeys.spendingBreakdownAll(accountId) },
    { queryKey: accountKeys.cashFlowAll(accountId) },
  ]));
}

/**
 * Invalidates every cached query under specific account scopes
 */
export function invalidateAccountData(queryClient: QueryClient, accountIds: string[]) {
  invalidateAccountSummaries(queryClient);
  invalidateTargets(queryClient, accountIds.map((accountId) => ({
    queryKey: accountKeys.accountScope(accountId),
  })));
}
